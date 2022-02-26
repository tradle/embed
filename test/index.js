const test = require('tape')
const QueryString = require('querystring')
const {
  isKeeperUri,
  buildKeeperUri,
  parseKeeperUri,
  getS3UrlForKeeperUri,
  replaceKeeperUris,
  replaceDataUrls,
  resolveEmbeds,
  getEmbeds,
  PREFIX,
  PROTOCOL,
  stripEmbedPrefix,
  presignUrls,
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
      "body": Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
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
      "body": Buffer.from('ffc8ffe000104a46494600010100000100010000', 'hex'),
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
      b: { c: `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}` },
      d: { e: `${PREFIX.presigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}` }
    }
  }), {
    a: {
      b: { c: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}` },
      d: { e: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash}` }
    }
  })

  t.end()
})

test('resolveEmbeds', async t => {
  const bucket = 'mybucket'
  const host = `${bucket}.s3.amazonaws.com`
  const hostUrl = `https://${host}`
  t.deepEqual(
    await resolveEmbeds({
      object: {
        a: 'https://unprefixed'
      },
      async resolve(input) {
        t.fail(input)
      }
    }),
    {
      a: 'https://unprefixed'
    }
  )
  let count = 0
  t.deepEqual(
    await resolveEmbeds({
      object: {
        a: `${PREFIX.unsigned}${hostUrl}/a`,
        b: `${PREFIX.unsigned}${hostUrl}/b`
      },
      async resolve (input) {
        const key = count === 0 ? 'a' : 'b'
        t.deepEqual(input, {
          url: `${hostUrl}/${key}`,
          query: {},
          host,
          bucket,
          key,
          value: `u:s3:${hostUrl}/${key}`,
          path: key
        })
        count++
        return input.path
      }
    }),
    {
      a: 'data:text/plain;charset=UTF-8;base64,YQ==',
      b: 'data:text/plain;charset=UTF-8;base64,Yg=='
    }
  )
  t.end()
})

test('presignUrls', t => {
  const unprefixed = 'https://unprefixed'
  t.deepEqual(presignUrls({
    object: { unprefixed },
    sign(input) {
      t.fail(input)
    }
  }), { unprefixed })
  const bucket = 'mybucket'
  const host = `${bucket}.s3.amazonaws.com`
  const hostUrl = `https://${host}`
  t.deepEqual(presignUrls({
    object: { foo: `${PREFIX.unsigned}${hostUrl}/bar` },
    sign (input) {
      t.deepEqual(input, {
        bucket: 'mybucket',
        key: 'bar',
        path: 'foo'
      })
      return 'baz'
    }
  }), { foo: 'p:s3:baz' })
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

  t.same(parseKeeperUri('tradle-keeper://deadbeef/?a=b'), {
    type: "tradle-keeper",
    hash: 'deadbeef',
    a: 'b',
  }, 'parse with slash before query')

  t.same(parseKeeperUri('tradle-keeper://deadbeef?a=b'), {
    type: "tradle-keeper",
    hash: 'deadbeef',
    a: 'b',
  }, 'parse with no slash before query')

  t.end()
})
