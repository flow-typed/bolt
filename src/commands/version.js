// @flow
import semver from 'semver';
import path from 'path';
import * as fs from '../utils/fs';
import * as options from '../utils/options';
import onExit from 'signal-exit';
import Project from '../Project';
import Package from '../Package';
import { BoltError } from '../utils/errors';
import type { FilterOpts, SpawnOpts } from '../types';

export type VersionOptions = {
  cwd?: string,
  spawnOpts?: SpawnOpts,
  filterOpts: FilterOpts
};

export function toVersionOptions(
  args: options.Args,
  flags: options.Flags
): VersionOptions {
  return {
    cwd: options.string(flags.cwd, 'cwd'),
    filterOpts: options.toFilterOpts(flags)
  };
}

export async function version(opts: VersionOptions) {
  let cwd = opts.cwd || process.cwd();
  let spawnOpts = opts.spawnOpts || {};
  let filterOpts = opts.filterOpts || {};
  let project: Project = await Project.init(cwd);
  let packages = await project.getPackages();
  let filteredPackages = project.filterPackages(packages, filterOpts);
  let publicPackages = filteredPackages.filter(pkg => !pkg.config.getPrivate());

  if (cwd !== project.pkg.dir) {
    let pkg = await Package.init(path.join(cwd, 'package.json'));
    publicPackages = [pkg].filter(pkg => !pkg.config.getPrivate());
  }

  let { paths, packagesByName } = await project.getDependencyGraph(packages);

  await project.runPackageTasks(publicPackages, spawnOpts, async pkg => {
    let name = pkg.config.getName();
    let version = pkg.config.getVersion();
    let size = packagesByName.get(name).length;
    let links = paths.get(pkg) || new Map();
    let versionDir = pkg.dir;

    const pkgBackup = `${pkg.filePath}.bolt_backup`;
    await fs.rename(pkg.filePath, pkgBackup);
    const cleanup = () => {
      fs.renameSync(pkgBackup, pkg.filePath);
    };
    const unregister = onExit(cleanup);

    const semverVersion = semver.parse(version);
    semverVersion.patch += size;
    semverVersion.format();

    await pkg.config.write({
      ...pkg.config.getConfig(),
      version: semverVersion.toString()
    });

    unregister();
  });
}
