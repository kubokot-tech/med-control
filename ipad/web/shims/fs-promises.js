import { promises } from './fs.js';
export const { readFile, writeFile, appendFile, mkdir, stat, lstat, readdir, unlink, rm, rename, copyFile, chmod, access, realpath, rmdir } = promises;
export default promises;
