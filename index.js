const crypto = require('crypto')
const parseUrl = require('url').parse
const qs = require('querystring')
const co = require('co').wrap
const IP = require('ip')
const dotProp = require('dot-prop')
const traverse = require('traverse')
const DataURI = require('strong-data-uri')
const decodeDataURI = DataURI.decode
const encodeDataURI = DataURI.encode
const PREFIX = {
  // same length
  presigned: 'p:s3:',
  unsigned: 'u:s3:'
}

// const AWS_HOSTNAME_REGEX = /\.amazonaws\.com$/
const S3_URL_REGEX = /^(?:https?|s3):\/\/([^.]+)\.s3\.amazonaws.com\/([^?]*)/
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

  const query = qs.parse(parsed.query || '')
  const {
    AWSAccessKeyId,
    Expires,
    Signature
  } = query

  const presigned = AWSAccessKeyId && Expires && Signature
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

function replaceDataUrls ({
  region=DEFAULT_REGION,
  endpoint,
  object,
  bucket,
  keyPrefix=''
}) {
  if (!bucket) {
    throw new Error('"bucket" is required')
  }

  if (!endpoint) {
    endpoint = getS3Endpoint(region)
  }

  return traverse(object).reduce(function (replacements, value) {
    if (!this.isLeaf ||
      typeof value !== 'string' ||
      !value.startsWith('data:')
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
    let protocol, host, s3Url
    if (isPrivateEndpoint(endpoint)) {
      protocol = 'http:'
      s3Url = `${protocol}//${endpoint}/${bucket}/${key}`
    } else {
      protocol = 'https:'
      host = `${bucket}.${endpoint}`
      s3Url = `${protocol}//${host}/${key}`
    }

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

const resolveEmbeds = co(function* ({ object, resolve }) {
  const embeds = getEmbeds(object)
  if (!embeds.length) return object

  const values = yield embeds.map(embed => resolve(embed))
  embeds.forEach(({ path }, i) => {
    const value = values[i]
    const dataUri = encodeDataURI(value, value.mimetype)
    dotProp.set(object, path, dataUri)
  })

  return object
})

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
  embed.value = value
  if (embed) {
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
  isPrivateEndpoint
}
