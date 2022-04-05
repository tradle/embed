import pMap = require('p-map')
import crypto = require('crypto')
import url = require('url')
import QueryString = require('querystring')
import IP = require('ip')
import dotProp = require('dot-prop')
import caseless = require('caseless')
import traverse = require('traverse')
import strongDataURI = require('strong-data-uri')
import {
  KnownRegions, S3Location, Embed, ReplacedKeeperURI,
  Replacement, ReplaceOptions, DataURI, S3UploadTarget,
  KeeperURI, PresignOptions, S3Target, DEFAULT_REGION, S3_ENDPOINTS
} from './types'

export * from './types'

const parseUrl = url.parse
const {
  decode: decodeDataURI,
  encode: encodeDataURI
} = strongDataURI

export { decodeDataURI, encodeDataURI }

export const PREFIX = Object.freeze({
  // same length
  presigned: 'p:s3:',
  unsigned: 'u:s3:'
} as const)

export const PROTOCOL = Object.freeze({
  // same length
  http: 'http:',
  https: 'https:',
  keeper: 'tradle-keeper:',
  dataUrl: 'data:'
} as const)

// const AWS_HOSTNAME_REGEX = /\.amazonaws\.com$/
const S3_URL_REGEX = /^(?:https?|s3):\/\/([^.]+)\.s3.*?\.amazonaws.com\/([^?]*)/

const DEFAULT_ENDPOINT = S3_ENDPOINTS[DEFAULT_REGION]

export function getS3Endpoint (): typeof DEFAULT_ENDPOINT
export function getS3Endpoint (region: null | undefined): typeof DEFAULT_ENDPOINT
export function getS3Endpoint <K extends KnownRegions | string> (region: K):
K extends KnownRegions
  ? typeof S3_ENDPOINTS[K]
  : typeof DEFAULT_ENDPOINT

export function getS3Endpoint (region?: KnownRegions | null): string {
  return region !== null && region !== undefined && region in S3_ENDPOINTS ? S3_ENDPOINTS[region] : DEFAULT_ENDPOINT
}

export function parseS3Url (url: string): S3Location | undefined {
  if (!/^https?:/.test(url)) return

  let parsed: url.UrlWithStringQuery
  try {
    parsed = parseUrl(url)
    /* c8 ignore next 3 */
  } catch (err) {
    return
  }

  const query: { [key: string]: string | string[] | undefined } = Object.assign({}, QueryString.parse(parsed.query ?? ''))
  const caselessQuery = caseless(query)
  const presigned = Boolean(caselessQuery.has('signature')) || Boolean(caselessQuery.has('x-amz-signature'))

  let match = url.match(S3_URL_REGEX) as ([string, string, string] | null)
  if (match === null) {
    const { pathname } = parsed
    if (pathname === null || pathname === undefined) return

    match = pathname.match(/^\/?([^/]+)\/(.+)/) as ([string, string, string] | null)
    if (match === null) return
  }
  const s3Location: S3Location = {
    url,
    query,
    host: parsed.host,
    bucket: match[1],
    key: match[2]
  }
  if (presigned) {
    s3Location.presigned = true
  }

  return s3Location
}

function sha256 (strOrBuffer: string | Buffer): string {
  return crypto.createHash('sha256').update(strOrBuffer).digest('hex')
}

export function stripEmbedPrefix <T> (object: T): T {
  traverse(object).forEach(function (value) {
    const embed = parseEmbeddedValue.call(this, value)
    if (embed != null) {
      this.update(embed.url)
    }
  })

  return object
}

export function replaceKeeperUris ({
  region = DEFAULT_REGION,
  endpoint: ep,
  object,
  bucket,
  keyPrefix = ''
}: ReplaceOptions): ReplacedKeeperURI[] {
  const endpoint = ep ?? getS3Endpoint(region)

  return traverse(object).reduce(function (replacements: ReplacedKeeperURI[], value) {
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
      key
    })

    this.update(PREFIX.unsigned + s3Url)
    return replacements
  }, []) as ReplacedKeeperURI[]
}

export function replaceDataUrls ({
  region = DEFAULT_REGION,
  endpoint: ep,
  object,
  bucket,
  keyPrefix = ''
}: ReplaceOptions): Replacement[] {
  const endpoint = ep ?? getS3Endpoint(region)

  return traverse(object).reduce(function (replacements: Replacement[], value) {
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
  }, []) as Replacement[]
}

export async function resolveEmbeds <T> (
  { object, resolve, concurrency = Infinity }:
  {
    object: T
    resolve: (embed: Embed) => Promise<DataURI>
    concurrency?: number
  }
): Promise<T> {
  const embeds = getEmbeds(object)
  if (embeds.length === 0) return object

  const values = await pMap(embeds, async embed => await resolve(embed), { concurrency })
  embeds.forEach(({ path }, i) => {
    const value = values[i] as DataURI
    const dataUri = encodeDataURI(value, value.mimetype)
    dotProp.set(object, path, dataUri)
  })

  return object
}

export function parseKeeperUri (uri: string): KeeperURI {
  // parseUrl doesn't work. It cuts off the last character of the hash when parsing
  // hash as hostname
  const [hash, qs = ''] = uri
    .slice(PROTOCOL.keeper.length + 2)
    .replace(/\/\?/, '?') // => /? -> ?
    .split(/[?]/) as [string, string | undefined]

  const query = QueryString.parse(qs)
  const result: KeeperURI = {
    type: 'tradle-keeper',
    hash: hash.toLowerCase()
  }

  for (let [key, value] of Object.entries(query) as Array<[key: string, value: string | string []]>) {
    // flatten eventual arrays
    if (Array.isArray(value)) {
      value = value[0] as string
    }
    result[key] = value
  }

  return result
}

export function buildKeeperUri ({ hash, ...details }: {
  hash: string
} & QueryString.ParsedUrlQueryInput): string {
  const qs = QueryString.stringify(details)
  return `${PROTOCOL.keeper}//${hash.toLowerCase()}/?${qs}`
}

export function isKeeperUri (uri: string): boolean {
  return uri.startsWith(PROTOCOL.keeper + '//')
}

export function parseEmbeddedValue (this: { isLeaf: boolean, path: string[] }, value: string): Embed | undefined {
  if (!(this.isLeaf && typeof value === 'string')) {
    return
  }

  let prefix
  if (value.startsWith(PREFIX.presigned)) {
    prefix = PREFIX.presigned
  } else if (value.startsWith(PREFIX.unsigned)) {
    prefix = PREFIX.unsigned
  } else {
    return
  }

  const embed = parseS3Url(value.slice(prefix.length))
  if (embed === undefined) {
    return
  }
  return {
    ...embed,
    value,
    path: this.path.join('.')
  }
}

export function getEmbeds (object: any): Embed[] {
  return traverse(object).reduce(function (embeds: Embed[], value) {
    const embed = parseEmbeddedValue.call(this, value)
    if (embed != null) {
      embeds.push(embed)
    }

    return embeds
  }, []) as Embed[]
}

export function presignUrls <T> ({ object, sign }: PresignOptions<T>): T {
  for (const { bucket, key, path } of getEmbeds(object)) {
    const url = sign({ bucket, key, path })
    dotProp.set(object, path, PREFIX.presigned + url)
  }
  return object
}

export function isPrivateEndpoint (endpoint: string): boolean {
  const host = endpoint
    .replace(/^https?:\/\//, '')
    .split(':')[0] as string

  return host === 'localhost' || IP.isPrivate(host)
}

export function getS3UploadTarget ({ endpoint, key, bucket }: S3Target): S3UploadTarget {
  if (!(bucket as unknown as boolean) /* Typescript will catch it, JS protection */) {
    throw new Error('"bucket" is required')
  }

  if (isPrivateEndpoint(endpoint)) {
    return {
      host: endpoint,
      s3Url: `http://${endpoint}/${bucket}/${key}`
    }
  }

  const host = `${bucket}.${endpoint}`
  return {
    host,
    s3Url: `https://${host}/${key}`
  }
}

export function getS3UrlForKeeperUri ({
  region = DEFAULT_REGION,
  endpoint,
  bucket,
  keyPrefix = '',
  uri
}: {
  region?: KnownRegions | string
  endpoint?: string
  bucket: string
  keyPrefix?: string
  uri: string
}): string {
  endpoint ??= getS3Endpoint(region)

  const { hash } = parseKeeperUri(uri)
  const { s3Url } = getS3UploadTarget({
    key: keyPrefix + hash,
    bucket,
    endpoint
  })

  return s3Url
}
