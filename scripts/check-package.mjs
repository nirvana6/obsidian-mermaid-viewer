import { build } from 'esbuild';
import { releaseNotes } from './release-utils.mjs';
import { PACKAGE_ASSETS } from './package-assets.mjs';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFile(path.join(root, name), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));
const pkg = JSON.parse(await read('package.json'));
const versions = JSON.parse(await read('versions.json'));
const errors = [];
const semver = /^\d+\.\d+\.\d+(?:-fork(?:\.\d+)?)?$/;
if (!semver.test(manifest.version) || !semver.test(manifest.minAppVersion))
  errors.push('Versions must use x.y.z; the published manifest may carry a -fork suffix.');
if (pkg.version !== manifest.version) errors.push('package.json version differs from manifest.');
if (versions[manifest.version] !== manifest.minAppVersion)
  errors.push('versions.json is missing the current compatibility entry.');
if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id) || /obsidian|plugin$/.test(manifest.id))
  errors.push('Invalid plugin ID.');
for (const name of ['main.js', ...PACKAGE_ASSETS]) {
  try {
    await access(path.join(root, 'dist', name));
  } catch {
    errors.push(`Missing dist/${name}. Run npm run build.`);
  }
}
for (const name of PACKAGE_ASSETS) {
  if (name === 'styles.css') continue;
  try {
    const source = await readFile(path.join(root, name));
    const packaged = await readFile(path.join(root, 'dist', name));
    if (!source.equals(packaged)) errors.push(`dist/${name} is stale.`);
  } catch {
    /* Reported above. */
  }
}
const css = await build({
  absWorkingDir: root,
  entryPoints: ['styles.css'],
  bundle: true,
  target: 'es2022',
  write: false,
});
if ((await read('dist/styles.css')) !== css.outputFiles[0].text)
  errors.push('dist/styles.css is stale.');
try {
  const meta = JSON.parse(await read('.build/metafile.json'));
  const imports = Object.values(meta.outputs).flatMap((output) => output.imports);
  if (imports.some((entry) => entry.path !== 'obsidian'))
    errors.push('Runtime bundle imports modules other than obsidian.');
} catch {
  errors.push('Build metadata missing; rebuild before checking.');
}
if (process.argv.includes('--release')) {
  try {
    releaseNotes(await read('CHANGELOG.md'), manifest.version);
  } catch (error) {
    errors.push(error.message);
  }
  if (!manifest.author || manifest.author === 'Local')
    errors.push('Set a public author name in manifest.json.');
  if (!/^[A-Za-z0-9 ()+-]+$/.test(manifest.name))
    errors.push('Choose a public Basic Latin plugin name.');
  if (!manifest.description.endsWith('.') || manifest.description.length > 250)
    errors.push('Public description must be <=250 characters and end with a period.');
  if (!pkg.repository) errors.push('Set package.json repository to the public source repository.');
  if (pkg.license === 'UNLICENSED') errors.push('Choose a license in package.json.');
  try {
    await access(path.join(root, 'LICENSE'));
  } catch {
    errors.push('Add the chosen LICENSE file.');
  }
  const index = process.argv.indexOf('--tag');
  if (index >= 0 && process.argv[index + 1] !== manifest.version)
    errors.push('Release tag must match manifest.version exactly (no v prefix).');
}
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else console.log('Package checks passed.');
