// fs as a plain writable object: graceful-fs (archiver) patches its methods, an ES module namespace refuses that.
const m = require('./fs.js');
module.exports = Object.assign({}, m.default, { promises: m.promises, hydrate: m.hydrate });
