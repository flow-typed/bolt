// @flow
import includes from 'array-includes';
import projectBinPath from 'project-bin-path';
import * as path from 'path';
import type { Dependency, configDependencyType } from '../types';
import type Package from '../Package';
import Project from '../Project';
import * as processes from './processes';
import * as fs from '../utils/fs';
import * as logger from '../utils/fs';
import { DEPENDENCY_TYPE_FLAGS_MAP, BOLT_VERSION } from '../constants';

function getLocalBinPath(): Promise<string> {
  return projectBinPath(__dirname);
}

function depTypeToFlag(depType) {
  let flag = Object.keys(DEPENDENCY_TYPE_FLAGS_MAP).find(
    key => DEPENDENCY_TYPE_FLAGS_MAP[key] === depType
  );

  return flag ? `--${flag}` : flag;
}

export async function install(cwd: string, pureLockfile?: boolean) {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');
  let installFlags = [];

  if (pureLockfile) installFlags.push('--pure-lockfile');

  let yarnUserAgent = await userAgent();
  let boltUserAgent = `bolt/${BOLT_VERSION} ${yarnUserAgent}`;

  await processes.spawn(localYarn, ['install', ...installFlags], {
    cwd,
    tty: true,
    env: {
      ...process.env,
      npm_config_user_agent: boltUserAgent,
      bolt_config_user_agent: boltUserAgent
    },
    useBasename: true
  });
}

export async function add(
  pkg: Package,
  dependencies: Array<Dependency>,
  type?: configDependencyType
) {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');
  let spawnArgs = ['add'];
  if (!dependencies.length) return;

  dependencies.forEach(dep => {
    if (dep.version) {
      spawnArgs.push(`${dep.name}@${dep.version}`);
    } else {
      spawnArgs.push(dep.name);
    }
  });

  if (type) {
    let flag = depTypeToFlag(type);
    if (flag) spawnArgs.push(flag);
  }

  await processes.spawn(localYarn, spawnArgs, {
    cwd: pkg.dir,
    pkg: pkg,
    tty: true
  });
}

export async function upgrade(
  pkg: Package,
  dependencies: Array<Dependency> = [],
  flags: Array<string> = []
) {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');
  let spawnArgs = ['upgrade'];

  if (dependencies.length) {
    dependencies.forEach(dep => {
      if (dep.version) {
        spawnArgs.push(`${dep.name}@${dep.version}`);
      } else {
        spawnArgs.push(dep.name);
      }
    });
  }

  await processes.spawn(localYarn, [...spawnArgs, ...flags], {
    cwd: pkg.dir,
    pkg: pkg,
    tty: true
  });
}

export async function run(
  pkg: Package,
  script: string,
  args: Array<string> = []
) {
  let project = await Project.init(pkg.dir);
  let localYarn = path.join(await getLocalBinPath(), 'yarn');
  // We use a relative path because the absolute paths are very long and noisy in logs
  let localYarnRelative = path.relative(pkg.dir, localYarn);
  let spawnArgs = ['run', '-s', script];

  if (args.length) {
    spawnArgs = spawnArgs.concat(args);
  }
  await processes.spawn(localYarnRelative, spawnArgs, {
    cwd: pkg.dir,
    pkg: pkg,
    tty: true,
    useBasename: true
  });
}

export async function runIfExists(
  pkg: Package,
  script: string,
  args: Array<string> = []
) {
  let scriptExists = await getScript(pkg, script);
  if (scriptExists) {
    await run(pkg, script, args);
  }
}

export async function getScript(pkg: Package, script: string) {
  let result = null;
  let scripts = pkg.config.getScripts();

  if (scripts && scripts[script]) {
    result = scripts[script];
  }

  if (!result) {
    let bins = await fs.readdirSafe(pkg.nodeModulesBin);

    if (includes(bins, script)) {
      result = script;
    }
  }

  return result;
}

export async function remove(dependencies: Array<string>, cwd: string) {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');
  await processes.spawn(localYarn, ['remove', ...dependencies], {
    cwd,
    tty: true
  });
}

export async function cliCommand(
  cwd: string,
  command: string = '',
  spawnArgs: Array<string> = []
) {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');

  return await processes.spawn(localYarn, [command, ...spawnArgs], {
    cwd,
    tty: true,
    useBasename: true
  });
}

export async function info(cwd: string, spawnArgs: Array<string> = []) {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');
  await processes.spawn(localYarn, ['info', ...spawnArgs], {
    cwd,
    tty: true
  });
}

export async function userAgent() {
  let localYarn = path.join(await getLocalBinPath(), 'yarn');

  let { stdout: yarnUserAgent } = await processes.spawn(
    localYarn,
    ['config', 'get', 'user-agent'],
    {
      tty: false
    }
  );

  return yarnUserAgent.replace(/\n/g, '');
}

export async function globalCli(
  command: string = '',
  dependencies: Array<Dependency>
) {
  let spawnArgs = ['global', command];
  if (!dependencies.length) return;

  dependencies.forEach(dep => {
    if (dep.version) {
      spawnArgs.push(`${dep.name}@${dep.version}`);
    } else {
      spawnArgs.push(dep.name);
    }
  });

  await processes.spawn('yarn', spawnArgs, {
    tty: true
  });
}
