const crypto = require('crypto')
const parseUrl = require('url').parse
const pMap = import('p-map')
const QueryString = require('querystring')
const IP = require('ip')
const dotProp = require('dot-prop')
const traverse = require('traverse')
const caseless = require('caseless')
const DataURI = require('strong-data-uri')
const decodeDataURI = DataURI.decode
const encodeDataURI = DataURI.encode
const PREFIX = {
  // same length
  presigned: 'p:s3:',
  unsigned: 'u:s3:',
}

const PROTOCOL = {
  // same length
  http: 'http:',
  https: 'https:',
  keeper: 'tradle-keeper:',
  dataUrl: 'data:',
}

// const AWS_HOSTNAME_REGEX = /\.amazonaws\.com$/
const S3_URL_REGEX = /^(?:https?|s3):\/\/([^.]+)\.s3.*?\.amazonaws.com\/([^?]*)/
const DEFAULT_REGION = 'us-east-1'
const S3_ENDPOINTS = {
  'us-east-1': 's3.amazonaws.com',
  'us-east-2': 's3-us-east-2.amazonaws.com',
  'us-west-1': 's3-us-west-1.amazonaws.com',
  'us-west-2': 's3-us-west-2.amazonaws.com',
  'ca-central-1': 's3.ca-central-1.amazonaws.com',
  'eu-west-1': 's3-eu-west-1.amazonaws.com',
  'eu-west-2': 's3-eu-west-2.amazonaws.com',
  'sa-east-1': 's3-sa-east-1.amazonaws.com',
  'eu-central-1': 's3-eu-central-1.amazonaws.com',
  'ap-south-1': 's3-ap-south-1.amazonaws.com',
  'ap-southeast-1': 's3-ap-southeast-1.amazonaws.com',
  'ap-southeast-2': 's3-ap-southeast-2.amazonaws.com',
  'ap-northeast-1': 's3-ap-northeast-1.amazonaws.com',
  'cn-north-1': 's3.cn-north-1.amazonaws.com.cn'
  // Add new endpoints here.
}

function getS3Endpoint (region) {
  return S3_ENDPOINTS[region] || S3_ENDPOINTS[DEFAULT_REGION]
}

function parseS3Url (url) {
  if (!/^https?:/.test(url)) return

  let parsed
  try {
    parsed = parseUrl(url)
  } catch (err) {
    return
  }

  const query = QueryString.parse(parsed.query || '')
  const caselessQuery = caseless(query)
  const presigned = Boolean(caselessQuery.has('signature') || caselessQuery.has('x-amz-signature'))

  // if (parsed.hostname !== 'localhost' && !presigned) {
  //   return
  // }

  const ret = {
    url,
    query,
    host: parsed.host
  }

  const match = url.match(S3_URL_REGEX)
  if (presigned) {
    ret.presigned = true
  }

  if (match) {
    ret.bucket = match[1]
    ret.key = match[2]
  } else {
    const { pathname='' } = parsed
    const match = pathname.match(/^\/?([^/]+)\/(.*)/)
    if (!match) return

    const [bucket, key] = match.slice(1)
    if (!(bucket && key)) return

    ret.bucket = bucket
    ret.key = key
  }

  return ret
  // return {
  //   url,
  //   host: parsed.host,
  //   query,
  //   bucket,
  //   key,
  //   presigned: !!presigned
  // }
}

function sha256 (strOrBuffer) {
  return crypto.createHash('sha256').update(strOrBuffer).digest('hex')
}

function stripEmbedPrefix (object) {
  traverse(object).reduce(function (embeds, value) {
    const embed = parseEmbeddedValue.call(this, value)
    if (embed) {
      this.update(embed.url)
    }
  })

  return object
}

function replaceKeeperUris ({
  region=DEFAULT_REGION,
  endpoint,
  object,
  bucket,
  keyPrefix=''
}) {
  if (!endpoint) {
    endpoint = getS3Endpoint(region)
  }

  return traverse(object).reduce(function (replacements, value) {
    if (!this.isLeaf ||
      typeof value !== 'string' ||
      !isKeeperUri(value)
    ) {
      return replacements
    }

    const parsed = parseKeeperUri(value)
    const key = keyPrefix + parsed.hash
    const { host, s3Url } = getS3UploadTarget({ endpoint, key, bucket })
    replacements.push({
      ...parsed,
      host,
      path: this.path.join('.'),
      s3Url,
      bucket,
      key,
    })

    this.update(PREFIX.unsigned + s3Url)
    return replacements
  }, [])
}

function replaceDataUrls ({
  region=DEFAULT_REGION,
  endpoint,
  object,
  bucket,
  keyPrefix=''
}) {
  if (!endpoint) {
    endpoint = getS3Endpoint(region)
  }

  return traverse(object).reduce(function (replacements, value) {
    if (!this.isLeaf ||
      typeof value !== 'string' ||
      !value.startsWith(PROTOCOL.dataUrl)
    ) {
      return replacements
    }

    let body
    try {
      body = decodeDataURI(value)
    } catch (err) {
      // not a data uri
      return replacements
    }

    const hash = sha256(body)
    const key = keyPrefix + hash
    const { host, s3Url } = getS3UploadTarget({ endpoint, key, bucket })
    replacements.push({
      dataUrl: value,
      hash,
      body,
      host,
      mimetype: body.mimetype,
      path: this.path.join('.'),
      s3Url,
      bucket,
      key
    })

    this.update(PREFIX.unsigned + s3Url)
    return replacements
  }, [])
}

async function resolveEmbeds ({ object, resolve, concurrency=Infinity }) {
  const embeds = getEmbeds(object)
  if (!embeds.length) return object

  const values = await (await pMap).default(map, embed => resolve(embed), { concurrency })
  embeds.forEach(({ path }, i) => {
    const value = values[i]
    const dataUri = encodeDataURI(value, value.mimetype)
    dotProp.set(object, path, dataUri)
  })

  return object
}

// function replaceEmbeds (object, fn) {
//   const promises = []
//   return new Promise((resolve, reject) => {
//     traverse(object).reduce(function (embeds, value) {
//       const embed = parseEmbeddedValue.call(this, value)
//       const replacement = fn(embed)
//       if (isPromise(replacement)) {
//         promises.push(
//           replacement.then(result => this.update(result))
//         )
//       } else {
//         this.update(replacement)
//       }
//     })

//     Promise.all(promises).then(() => resolve(object), reject)
//   })
// }

function parseKeeperUri (uri) {
  // parseUrl doesn't work. It cuts off the last character of the hash when parsing
  // hash as hostname
  const [hash, qs=''] = uri
    .slice(PROTOCOL.keeper.length + 2)
    .replace(/\/\?/, '?') // => /? -> ?
    .split(/[?]/)

  return {
    type: 'tradle-keeper',
    hash: hash.toLowerCase(),
    ...QueryString.parse(qs),
  }
}

function buildKeeperUri ({ hash, ...details }) {
  const qs = QueryString.stringify(details)
  return `${PROTOCOL.keeper}//${hash.toLowerCase()}/?${qs}`
}

function isKeeperUri (uri) {
  return uri.startsWith(PROTOCOL.keeper + '//')
}

function parseEmbeddedValue (value) {
  if (!(this.isLeaf && typeof value === 'string')) {
    return
  }

  let prefix
  let presigned
  if (value.startsWith(PREFIX.presigned)) {
    prefix = PREFIX.presigned
  } else if (value.startsWith(PREFIX.unsigned)) {
    prefix = PREFIX.unsigned
  } else {
    return
  }

  const embed = parseS3Url(value.slice(prefix.length))
  if (embed) {
    embed.value = value
    embed.path = this.path.join('.')
    return embed
  }
}

function getEmbeds (object) {
  return traverse(object).reduce(function (embeds, value) {
    const embed = parseEmbeddedValue.call(this, value)
    if (embed) {
      embeds.push(embed)
    }

    return embeds
  }, [])
}

function presignUrls ({ object, sign }) {
  const embeds = getEmbeds(object)
  embeds.forEach(({ bucket, key, path }) => {
    const url = sign({ bucket, key, path })
    dotProp.set(object, path, PREFIX.presigned + url)
  })

  return object
}

function isPromise (obj) {
  return obj && typeof obj.then === 'function'
}

function isPrivateEndpoint (endpoint) {
  const host = endpoint
    .replace(/^https?:\/\//, '')
    .split(':')[0]

  return host === 'localhost' || IP.isPrivate(host)
}

function getS3UploadTarget ({ endpoint, key, bucket }) {
  if (!bucket) {
    throw new Error('"bucket" is required')
  }

  if (isPrivateEndpoint(endpoint)) {
    return {
      host: endpoint,
      s3Url: `http://${endpoint}/${bucket}/${key}`,
    }
  }

  const host = `${bucket}.${endpoint}`
  return {
    host,
    s3Url: `https://${host}/${key}`,
  }
}

function getS3UrlForKeeperUri ({
  region=DEFAULT_REGION,
  endpoint,
  bucket,
  keyPrefix='',
  uri,
}) {
  if (!endpoint) {
    endpoint = getS3Endpoint(region)
  }

  const { hash } = parseKeeperUri(uri)
  const { s3Url } = getS3UploadTarget({
    key: keyPrefix + hash,
    bucket,
    endpoint,
  })

  return s3Url
}

const utils = module.exports = {
  parseS3Url,
  getS3Endpoint,
  replaceDataUrls,
  presignUrls,
  // replaceEmbeds,
  resolveEmbeds,
  getEmbeds,
  encodeDataURI,
  decodeDataURI,
  stripEmbedPrefix,
  PREFIX,
  PROTOCOL,
  isPrivateEndpoint,
  getS3UploadTarget,
  buildKeeperUri,
  parseKeeperUri,
  parseEmbeddedValue,
  isKeeperUri,
  getS3UrlForKeeperUri,
  replaceKeeperUris,
}
