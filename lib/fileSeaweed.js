const http = require('http');
const crypto = require('crypto');
const db = require('./database');
const FormData = require('form-data');

const weedAssign = require('url').parse(`${process.env.SEAWEED_HOST}/dir/assign`);

function collectJson (requestStream) {
  return collectBuffer(requestStream)
    .then(buffer => JSON.parse(buffer.toString()));
}

function collectBuffer (requestStream) {
  return new Promise((resolve, reject) => {
    const buffers = [];

    requestStream.on('data', (data) => {
      buffers.push(data);
    });
    requestStream.on('end', () => {
      try {
        resolve(Buffer.concat(buffers));
      } catch (e) {
        reject(e);
      }
    });
  });
}

http.ClientRequest.prototype.promise = function () {
  return new Promise((resolve, reject) => {
    this.once('error', reject);
    this.once('abort', () => reject(new Error('Aborted by the client')));
    this.once('aborted', () => reject(new Error('Aborted by the server')));
    this.once('response', resolve);
  });
};

module.exports = ({ key, contentType, body }) => {
  const hash = crypto.createHash('md5').update(body).digest('hex');
  let fid;

  return http.get({ path: weedAssign.path, host: weedAssign.hostname, port: weedAssign.port || 80 }).promise()
    .then(res => {
      if (res.statusCode > 299) throw new Error('unexpected response code from SeaweedFS assign request, got ' + res.statusCode);
      return res;
    })
    .then(res => collectJson(res))
    .then(json => {
      fid = json.fid;
      const putUrl = require('url').parse(`http://${json.url}/${fid}`);
      const form = new FormData();
      const req = http.request({ method: 'PUT', host: putUrl.hostname, port: putUrl.port, path: putUrl.path, headers: form.getHeaders() });
      form.append('file', body, {
        filename: key,
        contentType
      });
      form.pipe(req);
      return req.promise();
    })
    .then(res => {
      if (res.statusCode > 299) throw new Error('unexpected response code from SeaweedFS upload request, got ' + res.statusCode);
      return res;
    })
    .then(() => {
      return db.query({
        name: 'create-object',
        text: 'INSERT INTO objects (bucket_key, bucket, key, dir, backend_file_id, content_type, md5_hash) VALUES ($1, \'public\', $2, \'/\', $3, $4, $5);'
      }, [`public/${key}`, `/${key}`, fid, contentType, hash]);
    });
};