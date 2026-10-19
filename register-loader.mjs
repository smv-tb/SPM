import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./next-esm-loader.mjs', pathToFileURL('./'));
