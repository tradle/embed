const test = require('tape')
const QueryString = require('querystring')
const {
  parseS3Url,
  isKeeperUri,
  buildKeeperUri,
  parseKeeperUri,
  getS3UrlForKeeperUri,
  getS3Endpoint,
  replaceKeeperUris,
  replaceDataUrls,
  getEmbeds,
  resolveEmbeds,
  getUnsignedEmbeds,
  encodeDataURI,
  decodeDataURI,
  PREFIX,
  PROTOCOL,
  stripEmbedPrefix,
} = require('../')

test('replace data urls', function (t) {
  const bucket = 'mybucket'
  const keyPrefix = 'mykeyprefix'
  const message = {
    object: {
      blah: {
        habla: [{
          photo: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD"
        }]
      },
      gooblae: "data:image/jpeg;base64,/8j/4AAQSkZJRgABAQAAAQABAAD"
    }
  }

  const hash1 = 'a30f31a6a61325012e8c25deb3bd9b59dc9a2b4350b2b18e3c02dca9a87fea0b'
  const hash2 = 'ffd81ef52c22fd853b1db477ceec2a735ef4875a17e18daa8d48a7ce1040c398'
  const photo = `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash1}`
  const gooblae = `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}`
  const dataUrls = replaceDataUrls({
    bucket,
    keyPrefix,
    object: message
  })

  t.same(dataUrls, [
    {
      "dataUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD",
      "hash": `${hash1}`,
      "body": new Buffer('ffd8ffe000104a46494600010100000100010000', 'hex'),
      "host": "mybucket.s3.amazonaws.com",
      "mimetype": "image/jpeg",
      "path": "object.blah.habla.0.photo",
      "s3Url": `https://mybucket.s3.amazonaws.com/${keyPrefix}${hash1}`,
      "bucket": "mybucket",
      "key": `${keyPrefix}${hash1}`
    },
    {
      "dataUrl": "data:image/jpeg;base64,/8j/4AAQSkZJRgABAQAAAQABAAD",
      "hash": `${hash2}`,
      "body": new Buffer('ffc8ffe000104a46494600010100000100010000', 'hex'),
      "host": "mybucket.s3.amazonaws.com",
      "mimetype": "image/jpeg",
      "path": "object.gooblae",
      "s3Url": `https://mybucket.s3.amazonaws.com/${keyPrefix}${hash2}`,
      bucket,
      "key": `${keyPrefix}${hash2}`
    }
  ])

  t.same(message, {
    object: {
      blah: {
        habla: [{
          photo
        }]
      },
      gooblae
    }
  })

  const embeds = getEmbeds(message)
  t.same(embeds, [
    {
      url: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash1}`,
      host: `${bucket}.s3.amazonaws.com`,
      query: {},
      bucket,
      key: `${keyPrefix}${hash1}`,
      path: "object.blah.habla.0.photo",
      value: `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash1}`
    },
    {
      url: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}`,
      host: `${bucket}.s3.amazonaws.com`,
      query: {},
      bucket,
      key: `${keyPrefix}${hash2}`,
      path: "object.gooblae",
      value: `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}`
    }
  ])

  const querystring = 'AWSAccessKeyId=a&Expires=b&Signature=c'
  message.object.gooblae =
    `${PREFIX.presigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}?${querystring}`

  t.same(getEmbeds(message), [
    {
      url: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash1}`,
      query: {},
      host: `${bucket}.s3.amazonaws.com`,
      bucket,
      key: `${keyPrefix}${hash1}`,
      path: "object.blah.habla.0.photo",
      value: `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash1}`
    },
    {
      url: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}?${querystring}`,
      query: {
        AWSAccessKeyId: 'a',
        Expires: 'b',
        Signature: 'c'
      },
      host: `${bucket}.s3.amazonaws.com`,
      presigned: true,
      bucket,
      key: `${keyPrefix}${hash2}`,
      path: "object.gooblae",
      value: message.object.gooblae
    }
  ])

  t.end()
})

test('stripEmbedPrefix', function (t) {
  const bucket = 'mybucket'
  const keyPrefix = 'mykeyprefix'
  const hash = 'abc'
  t.same(stripEmbedPrefix({
    a: {
      b: {
        c: `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}`
      },
      d: {
        e: `${PREFIX.presigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}`
      }
    }
  }), {
    a: {
      b: {
        c: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}`,
      },
      d: {
        e: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}`,
      }
    }
  })

  t.end()
})

test('build/parse/is/replaceKeeperUris', t => {
  const hash = 'deadbeef'
  const mimetype = 'image/jpeg'
  const algorithm = 'sha256'
  const qs = QueryString.stringify({ algorithm, mimetype })
  const keeperUri = `${PROTOCOL.keeper}//${hash}/?${qs}`
  t.equal(isKeeperUri(keeperUri), true)
  t.equal(isKeeperUri('https://keeper.com'), false)
  t.same(keeperUri, buildKeeperUri({ hash, algorithm, mimetype }))
  t.same(parseKeeperUri(keeperUri), {
    type: 'tradle-keeper',
    hash,
    algorithm,
    mimetype,
  })

  const region = 'us-west-2'
  const bucket = 'abc.def'
  const keyPrefix = 'bloob/'
  const commonOpts = {
    keyPrefix,
    region,
    bucket,
  }

  t.equal(getS3UrlForKeeperUri({
    ...commonOpts,
    uri: keeperUri,
  }), 'https://abc.def.s3-us-west-2.amazonaws.com/bloob/deadbeef');

  const message = {
    object: {
      blah: {
        habla: [{
          photo: keeperUri
        }]
      },
      gooblae: "data:image/jpeg;base64,/8j/4AAQSkZJRgABAQAAAQABAAD"
    }
  }

  t.same(replaceKeeperUris({
    ...commonOpts,
    object: message
  }), [
    {
      type: "tradle-keeper",
      hash,
      algorithm,
      mimetype,
      host: `${bucket}.s3-us-west-2.amazonaws.com`,
      path: 'object.blah.habla.0.photo',
      s3Url: `https://${bucket}.s3-us-west-2.amazonaws.com/${keyPrefix}${hash}`,
      bucket,
      key: `${keyPrefix}${hash}`
    }
  ])

  t.end()
})
