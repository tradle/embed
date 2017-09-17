const test = require('tape')
const {
  parseS3Url,
  getS3Endpoint,
  replaceDataUrls,
  getEmbeds,
  resolveEmbeds,
  getUnsignedEmbeds,
  encodeDataURI,
  decodeDataURI,
  PREFIX,
  stripEmbedPrefix
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
      path: "object.blah.habla.0.photo"
    },
    {
      url: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}`,
      host: `${bucket}.s3.amazonaws.com`,
      query: {},
      bucket,
      key: `${keyPrefix}${hash2}`,
      path: "object.gooblae"
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
      path: "object.blah.habla.0.photo"
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
