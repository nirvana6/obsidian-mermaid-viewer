import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_ASSETS } from './package-assets.mjs';
import { releaseNotes, verifyReleaseAssets, verifyReleaseAssetList } from './release-utils.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const tag = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-fork(?:\.\d+)?)?$/.test(tag ?? '') || tag !== manifest.version)
  throw new Error('Release tag must match manifest.version exactly, without a v prefix.');
const notes = releaseNotes(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), tag);
const title = `Mermaid Viewer ${tag}`;
const gh = (...args) =>
  execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'mermaid-viewer-release-'));
try {
  const notesFile = path.join(temporary, 'notes.md');
  const downloads = path.join(temporary, 'assets');
  await writeFile(notesFile, notes);
  await mkdir(downloads);
  let existing;
  try {
    existing = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft'));
  } catch (error) {
    if (!/release not found/i.test(String(error.stderr))) throw error;
  }
  const assets = RELEASE_ASSETS.map((name) => path.join(root, 'dist', name));
  if (!existing) {
    gh(
      'release',
      'create',
      tag,
      ...assets,
      '--verify-tag',
      '--draft',
      '--title',
      title,
      '--notes-file',
      notesFile,
    );
  } else if (existing.isDraft) {
    gh('release', 'upload', tag, ...assets, '--clobber');
  }
  // Never publish before fetching back the direct release attachments. Published
  // releases are verified on reruns, never silently replaced with another build.
  gh(
    'release',
    'download',
    tag,
    '--dir',
    downloads,
    ...RELEASE_ASSETS.flatMap((name) => ['--pattern', name]),
  );
  await verifyReleaseAssets(path.join(root, 'dist'), downloads, tag);
  const draft = JSON.parse(gh('release', 'view', tag, '--json', 'assets'));
  verifyReleaseAssetList(draft.assets);
  const repo = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner')).nameWithOwner;
  for (const name of RELEASE_ASSETS) {
    gh(
      'attestation',
      'verify',
      path.join(downloads, name),
      '--repo',
      repo,
      '--signer-workflow',
      `${repo}/.github/workflows/release.yml`,
      '--source-ref',
      `refs/tags/${tag}`,
    );
    console.log(`Verified build provenance for ${name}.`);
  }
  gh('release', 'edit', tag, '--title', title, '--notes-file', notesFile, '--draft=false');
  const release = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,name,body,url,assets'));
  if (release.isDraft || !release.name.includes(tag) || !release.body.trim())
    throw new Error('Release metadata is incomplete after publication.');
  verifyReleaseAssetList(release.assets);
  console.log(`Published and verified ${release.url}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
