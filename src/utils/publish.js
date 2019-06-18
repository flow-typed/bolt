// @flow
import semver from 'semver';
import path from 'path';
import * as fs from './fs';
import onExit from 'signal-exit';
import * as flowVersion from './flowVersion';
import * as options from './options';
import { BoltError } from './errors';
import * as logger from './logger';
import * as messages from './messages';
import * as locks from './locks';
import * as npm from './npm';
import Project from '../Project';
import Package from '../Package';
import type { SpawnOpts } from '../types';

export type PublishOptions = {|
  cwd?: string,
  access?: string,
  registry?: string,
  spawnOpts?: SpawnOpts,
  prePublish?: Function
|};

export type PackageMeta = {|
  name: string,
  newVersion: string,
  published: boolean
|};

async function getUnpublishedPackages(packages: Package[]) {
  let results = await Promise.all(
    packages.map(async pkg => {
      let config = pkg.config;
      let response = await npm.infoAllow404(config.getName());

      return {
        name: config.getName(),
        primaryKey: pkg.getPrimaryKey(),
        localVersion: config.getVersion(),
        isPublished: response.published,
        publishedVersion: response.pkgInfo.version || ''
      };
    })
  );

  let packagesToPublish = [];

  for (let pkgInfo of results) {
    let { name, isPublished, localVersion, publishedVersion } = pkgInfo;
    if (!isPublished) {
      packagesToPublish.push(pkgInfo);
    } else if (semver.gt(localVersion, publishedVersion)) {
      packagesToPublish.push(pkgInfo);
      logger.info(
        messages.willPublishPackage(localVersion, publishedVersion, name)
      );
    } else if (semver.lt(localVersion, publishedVersion)) {
      // If the local version is behind npm, something is wrong, we warn here, and by not getting published later, it will fail
      logger.warn(
        messages.willNotPublishPackage(localVersion, publishedVersion, name)
      );
    }
  }

  return packagesToPublish;
}

async function setTaggedDependencies(
  links: Map<string, Package>,
  pkg: Package
) {
  for (const [_, dep] of links) {
    await pkg.setDependencyVersionRange(
      dep.getName(),
      'dependencies',
      dep.config.getConfig().flowVersion
    );
  }
}

async function setTypingDependencies(pkg: Package) {
  let packageName = pkg.getName();
  let flowVersionRange = pkg.getFlowVersion();

  let flowBinVersion;
  let selfName;
  let selfVersion = `^${semver.major(pkg.getVersion())}.x`;

  if (packageName.startsWith('@flowtyped')) {
    let [nameOrScope, name] = packageName.split('/')[1].split('__');
    if (name) {
      selfName = `@${nameOrScope}/${name}`;
    } else {
      selfName = nameOrScope;
    }
  }

  if (flowVersionRange) {
    if (flowVersionRange.kind === 'all') {
      flowBinVersion = 'latest';
    } else {
      flowBinVersion = flowVersion.toSemverString(flowVersionRange);
    }
  }

  if (flowBinVersion)
    await pkg.setDependencyVersionRange(
      'flow-bin',
      'peerDependencies',
      flowBinVersion
    );
  if (selfName && selfVersion)
    await pkg.setDependencyVersionRange(
      selfName,
      'peerDependencies',
      selfVersion
    );
}

export async function publish(
  opts: PublishOptions = Object.freeze({})
): Promise<PackageMeta[]> {
  let cwd = opts.cwd || process.cwd();
  let spawnOpts = opts.spawnOpts || {};
  let project = await Project.init(cwd);
  let packages = await project.getPackages();
  let publicPackages = packages.filter(pkg => !pkg.config.getPrivate());
  let publishedPackages = [];

  if (cwd !== project.pkg.dir) {
    let pkg = await Package.init(path.join(cwd, 'package.json'));
    publicPackages = [pkg].filter(pkg => !pkg.config.getPrivate());
  }

  let dependencyGraph = await project.getDependencyGraph(packages);
  let paths = new Map();
  for (const pkg of dependencyGraph.paths.keys()) {
    paths.set(pkg.filePath, dependencyGraph.paths.get(pkg));
  }

  try {
    // TODO: Re-enable once locking issues are sorted out
    // await locks.lock(packages);
    let unpublishedPackagesInfo = await getUnpublishedPackages(publicPackages);
    let unpublishedPackages = publicPackages.filter(pkg => {
      return unpublishedPackagesInfo.some(
        p => pkg.getPrimaryKey() === p.primaryKey
      );
    });

    if (unpublishedPackagesInfo.length === 0) {
      logger.warn(messages.noUnpublishedPackagesToPublish());
    }

    await project.runPackageTasks(unpublishedPackages, spawnOpts, async pkg => {
      let name = pkg.config.getName();
      let version = pkg.config.getVersion();
      let links = paths.get(pkg.filePath) || new Map();
      logger.info(messages.publishingPackage(name, version));

      let publishDir = pkg.dir;

      if (opts.prePublish) {
        publishDir =
          (await opts.prePublish({
            name,
            pkg
          })) || pkg.dir;
      }

      const pkgBackup = `${pkg.filePath}.bolt_backup`;
      await fs.rename(pkg.filePath, pkgBackup);
      const cleanup = () => {
        fs.renameSync(pkgBackup, pkg.filePath);
      };
      const unregister = onExit(cleanup);
      await setTaggedDependencies(links, pkg);
      await setTypingDependencies(pkg);

      let publishConfirmation = await npm.publish(name, {
        cwd: publishDir,
        registry: opts.registry,
        access: opts.access
      });

      publishedPackages.push({
        name,
        newVersion: version,
        published: publishConfirmation && publishConfirmation.published
      });

      cleanup();
      unregister();
    });

    return publishedPackages;

    // TODO: Re-enable once locking issues are sorted out
    // await locks.unlock(packages);
  } catch (err) {
    logger.error(err.message);
    throw new BoltError('Failed to publish');
  }
}
