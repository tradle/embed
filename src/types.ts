import { DataURI } from 'strong-data-uri'
export { DataURI }

export const DEFAULT_REGION = 'us-east-1'
export const S3_ENDPOINTS = Object.freeze({
  'us-east-1': 's3.amazonaws.com',
  'us-east-2': 's3-us-east-2.amazonaws.com',
  'us-west-1': 's3-us-west-1.amazonaws.com',
  'us-west-2': 's3-us-west-2.amazonaws.com',
  'ca-central-1': 's3.ca-central-1.amazonaws.com',
  'eu-west-1': 's3-eu-west-1.amazonaws.com',
  'eu-west-2': 's3-eu-west-2.amazonaws.com',
  'sa-east-1': 's3-sa-east-1.amazonaws.com',
  'eu-central-1': 's3-eu-central-1.amazonaws.com',
  'eu-central-2': 's3-eu-central-2.amazonaws.com',
  'ap-south-1': 's3-ap-south-1.amazonaws.com',
  'ap-southeast-1': 's3-ap-southeast-1.amazonaws.com',
  'ap-southeast-2': 's3-ap-southeast-2.amazonaws.com',
  'ap-northeast-1': 's3-ap-northeast-1.amazonaws.com',
  'cn-north-1': 's3.cn-north-1.amazonaws.com.cn',
  'af-south-1': 's3.af-south-1.amazonaws.com',
  'ap-east-1': 's3.ap-east-1.amazonaws.com',
  'ap-southeast-3': 's3.ap-southeast-3.amazonaws.com',
  'ap-northeast-3': 's3.ap-northeast-3.amazonaws.com',
  'ap-northeast-2': 's3.ap-northeast-2.amazonaws.com',
  'eu-south-1': 's3.eu-south-1.amazonaws.com',
  'eu-west-3': 's3.eu-west-3.amazonaws.com',
  'eu-north-1': 's3.eu-north-1.amazonaws.com',
  'me-south-1': 's3.me-south-1.amazonaws.com',
  'us-gov-east-1': 's3.us-gov-east-1.amazonaws.com',
  'us-gov-west-1': 's3.us-gov-west-1.amazonaws.com'
  // Add new endpoints here.
} as const)

export type KnownRegions = keyof typeof S3_ENDPOINTS

export interface S3Target {
  endpoint: string
  key: string
  bucket: string
}

export interface S3UploadTarget {
  host: string
  s3Url: string
}

export interface ReplaceOptions {
  region?: KnownRegions | string
  endpoint?: string
  object: Object
  bucket: string
  keyPrefix?: string
}

export interface PresignOptions <T> {
  object: T
  sign: (embed: Pick<Embed, 'bucket' | 'key' | 'path'>) => string
}

export interface Embed extends S3Location {
  value: string
  path: string
}

export interface KeeperURI {
  type: 'tradle-keeper' | string
  hash: string
  [key: string]: string
}

export interface ReplacedKeeperURI extends KeeperURI {
  host: string
  path: string
  s3Url: string
  key: string
  bucket: string
}

export interface S3Location {
  url: string
  query: { [key: string]: string | string[] | undefined }
  host: string | null
  bucket: string
  key: string
  presigned?: boolean
}

export interface Replacement {
  dataUrl: string
  hash: string
  body: Buffer & DataURI
  mimetype: string
  path: string
  s3Url: string
  host: string | null
  bucket: string
  key: string
}
