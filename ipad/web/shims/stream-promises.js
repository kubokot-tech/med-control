import { pipeline as cbPipeline, finished as cbFinished } from 'stream';
export const pipeline = (...streams) => new Promise((res, rej) => cbPipeline(...streams, (e) => (e ? rej(e) : res())));
export const finished = (s, o) => new Promise((res, rej) => cbFinished(s, o || {}, (e) => (e ? rej(e) : res())));
export default { pipeline, finished };
