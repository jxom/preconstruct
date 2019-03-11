// @flow
import is from "sarcastic";
import nodePath from "path";
import { promptInput } from "./prompt";
import pLimit from "p-limit";
import resolveFrom from "resolve-from";
import { Item } from "./item";
import { Package } from "./package";

// move this to the flow-typed folder later
let globby: {
  (globs: string | Array<string>, options: Object): Promise<Array<string>>,
  sync: (globs: string | Array<string>, options: Object) => Array<string>
} = require("globby");

let unsafeRequire = require;

let askGlobalLimit = pLimit(1);

export class Project extends Item {
  get configPackages(): Array<string> | null {
    return is(this._config.packages, is.maybe(is.arrayOf(is.string)));
  }
  // probably gonna be irrelevant later but i want it for now
  get isBolt(): boolean {
    // we only want to return true when there is bolt config
    // AND no yarn workspaces config
    // because emotion has a bolt config and yarn workspaces
    // and if you have both, you probably want workspaces
    let hasBolt = !!this.json.bolt;
    let hasYarnWorkspaces = !!this.json.workspaces;
    return hasBolt && !hasYarnWorkspaces;
  }

  get name(): string {
    return is(this.json.name, is.string);
  }
  set name(name: string) {
    this.json.name = name;
  }
  packages: Array<Package>;
  async _init() {
    this.packages = await this._packages();
  }
  _initSync() {
    this.packages = this._packagesSync();
  }

  async _packages(): Promise<Array<Package>> {
    // suport bolt later probably
    // maybe lerna too though probably not
    if (!this.configPackages && this.json.workspaces) {
      let _workspaces;
      if (Array.isArray(this.json.workspaces)) {
        _workspaces = this.json.workspaces;
      } else if (Array.isArray(this.json.workspaces.packages)) {
        _workspaces = this.json.workspaces.packages;
      }

      let workspaces = is(_workspaces, is.arrayOf(is.string));

      let packages = await promptInput(
        "what packages should preconstruct build?",
        this,
        workspaces.join(",")
      );

      this._config.packages = packages.split(",");

      await this.save();
    }
    let configPackages = this.configPackages;

    if (!configPackages) {
      let pkg = await Package.create(this.directory);
      pkg.project = this;
      return [pkg];
    }

    try {
      let filenames = await globby(configPackages, {
        cwd: this.directory,
        onlyDirectories: true,
        absolute: true,
        expandDirectories: false
      });

      let packages = await Promise.all(
        filenames.map(async x => {
          let pkg = await Package.create(x);
          pkg.project = this;
          return pkg;
        })
      );
      return packages;
    } catch (error) {
      if (error instanceof is.AssertionError) {
        return [];
      }
      throw error;
    }
  }
  _packagesSync(): Array<Package> {
    let configPackages = this.configPackages;

    if (!configPackages) {
      let pkg = Package.createSync(this.directory);
      pkg.project = this;
      return [pkg];
    }
    try {
      let filenames = globby.sync(configPackages, {
        cwd: this.directory,
        onlyDirectories: true,
        absolute: true,
        expandDirectories: false
      });
      let packages = filenames.map(x => {
        let pkg = Package.createSync(x);
        pkg.project = this;
        return pkg;
      });
      return packages;
    } catch (error) {
      if (error instanceof is.AssertionError) {
        return [];
      }
      throw error;
    }
  }

  global(pkg: string) {
    if (this._config.globals !== undefined && this._config.globals[pkg]) {
      return this._config.globals[pkg];
    } else {
      try {
        let pkgJson = unsafeRequire(
          resolveFrom(this.directory, nodePath.join(pkg, "package.json"))
        );
        if (pkgJson && pkgJson.preconstruct && pkgJson.preconstruct.umdName) {
          return pkgJson.preconstruct.umdName;
        }
      } catch (err) {
        if (err.code !== "MODULE_NOT_FOUND") {
          throw err;
        }
      }
      throw askGlobalLimit(() =>
        (async () => {
          // if while we were waiting, that global was added, return
          if (this._config.globals !== undefined && this._config.globals[pkg]) {
            return;
          }
          let response = await promptInput(
            `What should the umdName of ${pkg} be?`,
            this
          );
          this._addGlobal(pkg, response);
          await this.save();
        })()
      );
    }
  }

  _addGlobal(pkg: string, name: string) {
    if (!this._config.globals) {
      this._config.globals = {};
    }
    this._config.globals[pkg] = name;
  }
}
