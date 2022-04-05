import test = require('fresh-tape')
import QueryString = require('querystring')
import {
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
  getS3UploadTarget,
  parseS3Url,
  getS3Endpoint,
  encodeDataURI,
  decodeDataURI,
  isPrivateEndpoint,
  parseEmbeddedValue
} from '../src'
import {
  S3Target,
  DataURI
} from '../src/types'

test('isPrivateEndpoint', t => {
  t.equals(isPrivateEndpoint(''), false)
  t.equals(isPrivateEndpoint('localhost'), true)
  t.equals(isPrivateEndpoint('https://localhost'), true)
  t.equals(isPrivateEndpoint('10.10.10.10'), true)
  // TODO: Bug?
  t.equals(isPrivateEndpoint('::1'), false)
  t.end()
})

test('dataURI - only API availability', t => {
  const dataURI = 'data:application/octet-stream;base64,AA=='
  t.equals(encodeDataURI(Buffer.alloc(1)), dataURI)
  t.deepEqual(decodeDataURI(dataURI), Buffer.alloc(1))
  t.end()
})

test('parseEmbeddedValue', t => {
  t.same(parseEmbeddedValue.call({ isLeaf: false, path: [] }, 'hello'), undefined)
  t.same(parseEmbeddedValue.call({ isLeaf: false, path: [] }, 1 as unknown as string), undefined)
  t.same(parseEmbeddedValue.call({ isLeaf: true, path: [] }, 'hello'), undefined)
  t.same(parseEmbeddedValue.call({ isLeaf: true, path: [] }, 'hello'), undefined)
  t.same(parseEmbeddedValue.call({ isLeaf: true, path: [] }, `${PREFIX.unsigned}`), undefined)
  const host = 'foo'
  const bucket = 'bar'
  const key = 'baz/bak'
  const url = `https://${host}/${bucket}/${key}?q=hello&q=world`
  t.deepEqual(
    parseEmbeddedValue.call({ isLeaf: true, path: ['xyz', 'abc'] }, `${PREFIX.presigned}${url}`),
    { url, query: { q: ['hello', 'world'] }, host, bucket, key, value: `p:s3:${url}`, path: 'xyz.abc' }
  )
  t.deepEqual(
    parseEmbeddedValue.call({ isLeaf: true, path: ['xyz', 'abc'] }, `${PREFIX.unsigned}${url}`),
    { url, query: { q: ['hello', 'world'] }, host, bucket, key, value: `u:s3:${url}`, path: 'xyz.abc' }
  )
  t.end()
})

test('parseS3Url', t => {
  const host = 'foo'
  const bucket = 'bar'
  const key = 'baz/bak'
  const url = `https://${host}/${bucket}/${key}?q=hello&q=world`
  t.same(parseS3Url(null as unknown as string), undefined)
  t.deepEqual(parseS3Url(url), {
    url,
    query: {
      q: ['hello', 'world']
    },
    host,
    bucket,
    key
  })
  t.same(parseS3Url('https://foo/bar/'), undefined)
  t.same(parseS3Url('https://foo/bar'), undefined)
  t.end()
})

test('getS3UploadTarget', t => {
  /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
  t.throws(() => getS3UploadTarget({ bucket: null as unknown as string } as S3Target))
  t.deepEqual(
    getS3UploadTarget({ endpoint: 'localhost', key: 'foo', bucket: 'bar' }),
    { host: 'localhost', s3Url: 'http://localhost/bar/foo' }
  )
  t.end()
})

test('getS3Endpoint', t => {
  t.equal(getS3Endpoint(''), 's3.amazonaws.com')
  t.equal(getS3Endpoint('us-west-1'), 's3-us-west-1.amazonaws.com')
  t.end()
})

test('replace data urls', function (t) {
  const bucket = 'mybucket'
  const keyPrefix = 'mykeyprefix'
  const message = {
    object: {
      blah: {
        habla: [{
          photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'
        }, {
          photo: 'data:'
        }]
      },
      gooblae: 'data:image/jpeg;base64,/8j/4AAQSkZJRgABAQAAAQABAAD'
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
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
      hash: `${hash1}`,
      body: Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
      host: 'mybucket.s3.amazonaws.com',
      mimetype: 'image/jpeg',
      path: 'object.blah.habla.0.photo',
      s3Url: `https://mybucket.s3.amazonaws.com/${keyPrefix}${hash1}`,
      bucket: 'mybucket',
      key: `${keyPrefix}${hash1}`
    },
    {
      dataUrl: 'data:image/jpeg;base64,/8j/4AAQSkZJRgABAQAAAQABAAD',
      hash: `${hash2}`,
      body: Buffer.from('ffc8ffe000104a46494600010100000100010000', 'hex'),
      host: 'mybucket.s3.amazonaws.com',
      mimetype: 'image/jpeg',
      path: 'object.gooblae',
      s3Url: `https://mybucket.s3.amazonaws.com/${keyPrefix}${hash2}`,
      bucket,
      key: `${keyPrefix}${hash2}`
    }
  ])

  t.same(message, {
    object: {
      blah: {
        habla: [{
          photo
        }, {
          photo: 'data:'
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
      path: 'object.blah.habla.0.photo',
      value: `${PREFIX.unsigned}https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash1}`
    },
    {
      url: `https://${bucket}.s3.amazonaws.com/${keyPrefix}${hash2}`,
      host: `${bucket}.s3.amazonaws.com`,
      query: {},
      bucket,
      key: `${keyPrefix}${hash2}`,
      path: 'object.gooblae',
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
      path: 'object.blah.habla.0.photo',
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
      path: 'object.gooblae',
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
      async resolve (input) {
        t.fail(String(input))
        /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
        return {} as DataURI
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
        const result = Buffer.from(input.path) as DataURI
        result.mediatype = 'baz'
        result.charset = null
        result.mimetype = 'foo/bar'
        return result
      }
    }),
    {
      a: 'data:foo/bar;base64,YQ==',
      b: 'data:foo/bar;base64,Yg=='
    }
  )
  t.end()
})

test('presignUrls', t => {
  const unprefixed = 'https://unprefixed'
  t.deepEqual(presignUrls({
    object: { unprefixed },
    sign (input) {
      t.fail(String(input))
      return ''
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
  const qs = QueryString.stringify({ algorithm, mimetype, customArray: ['a', 'b'], customEmpty: '' })
  const keeperUri = `${PROTOCOL.keeper}//${hash}/?${qs}`
  t.equal(isKeeperUri(keeperUri), true)
  t.equal(isKeeperUri('https://keeper.com'), false)
  t.same(buildKeeperUri({ hash, algorithm, mimetype }), `${PROTOCOL.keeper}//${hash}/?${QueryString.stringify({ algorithm, mimetype })}`)
  t.same(parseKeeperUri(keeperUri), {
    type: 'tradle-keeper',
    hash,
    algorithm,
    mimetype,
    customArray: 'a',
    customEmpty: ''
  })

  const region = 'us-west-2'
  const bucket = 'abc.def'
  const keyPrefix = 'bloob/'
  const commonOpts = {
    keyPrefix,
    region,
    bucket
  }

  t.equal(getS3UrlForKeeperUri({
    ...commonOpts,
    uri: keeperUri
  }), 'https://abc.def.s3-us-west-2.amazonaws.com/bloob/deadbeef')

  const message = {
    object: {
      blah: {
        habla: [{
          photo: keeperUri
        }]
      },
      gooblae: 'data:image/jpeg;base64,/8j/4AAQSkZJRgABAQAAAQABAAD'
    }
  }

  t.same(replaceKeeperUris({
    ...commonOpts,
    object: message
  }), [
    {
      type: 'tradle-keeper',
      hash,
      algorithm,
      mimetype,
      host: `${bucket}.s3-us-west-2.amazonaws.com`,
      path: 'object.blah.habla.0.photo',
      s3Url: `https://${bucket}.s3-us-west-2.amazonaws.com/${keyPrefix}${hash}`,
      bucket,
      key: `${keyPrefix}${hash}`,
      customArray: 'a',
      customEmpty: ''
    }
  ])

  t.same(parseKeeperUri('tradle-keeper://deadbeef/?a=b'), {
    type: 'tradle-keeper',
    hash: 'deadbeef',
    a: 'b'
  }, 'parse with slash before query')

  t.same(parseKeeperUri('tradle-keeper://deadbeef?a=b'), {
    type: 'tradle-keeper',
    hash: 'deadbeef',
    a: 'b'
  }, 'parse with no slash before query')

  t.end()
})
