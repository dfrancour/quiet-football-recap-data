/**
 * The publisher's checkout: pull before a pass, a commit per change, one
 * push per pass. Commits are made as the publisher's own identity, never a
 * person's, so the history tells the two apart.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Identity {
  name: string;
  email: string;
}

export interface Git {
  /** `offline` when the remote could not be reached; throws on a conflict. */
  pull(): Promise<"ok" | "offline">;
  /** Whether any of `paths` has changes not committed. */
  dirty(paths: readonly string[]): Promise<boolean>;
  commit(paths: readonly string[], message: string): Promise<void>;
  /** Puts `paths` back as last committed, new files included. */
  discard(paths: readonly string[]): Promise<void>;
  /** False when the push failed; the commits wait for the next pass. */
  push(): Promise<boolean>;
  /** Commits not yet pushed. */
  unpushed(): Promise<number>;
}

export class GitConflictError extends Error {
  constructor(detail: string) {
    super(
      `Pulling would conflict, so nothing was written. Resolve it in the checkout by hand. ${detail}`.trim(),
    );
    this.name = "GitConflictError";
  }
}

export class GitRepo implements Git {
  readonly #dir: string;
  readonly #env: NodeJS.ProcessEnv;

  constructor(dir: string, identity: Identity) {
    this.#dir = dir;
    this.#env = {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  /** Clones `remote` into `dir` unless a checkout is already there. */
  static async cloneIfMissing(remote: string, dir: string): Promise<void> {
    if (existsSync(`${dir}/.git`)) return;
    await run("git", ["clone", "--quiet", remote, dir], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  }

  async #git(...args: string[]): Promise<string> {
    const { stdout } = await run(
      "git",
      ["-c", "commit.gpgsign=false", ...args],
      { cwd: this.#dir, env: this.#env, maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout.trim();
  }

  async pull(): Promise<"ok" | "offline"> {
    try {
      await this.#git("pull", "--rebase", "--quiet");
      return "ok";
    } catch (error) {
      const inProgress = async (name: string) =>
        existsSync(
          resolve(this.#dir, await this.#git("rev-parse", "--git-path", name)),
        );
      const rebasing =
        (await inProgress("rebase-merge")) ||
        (await inProgress("rebase-apply"));
      if (rebasing) {
        await this.#git("rebase", "--abort").catch(() => undefined);
        throw new GitConflictError(stderrOf(error));
      }
      return "offline";
    }
  }

  async dirty(paths: readonly string[]): Promise<boolean> {
    return (await this.#git("status", "--porcelain", "--", ...paths)) !== "";
  }

  async commit(paths: readonly string[], message: string): Promise<void> {
    await this.#git("add", "--", ...paths);
    await this.#git("commit", "--quiet", "-m", message, "--", ...paths);
  }

  async discard(paths: readonly string[]): Promise<void> {
    await this.#git("reset", "--quiet", "--", ...paths).catch(() => undefined);
    await this.#git("checkout", "--", ...paths).catch(() => undefined);
    await this.#git("clean", "--quiet", "--force", "--", ...paths).catch(
      () => undefined,
    );
  }

  async push(): Promise<boolean> {
    try {
      await this.#git("push", "--quiet");
      return true;
    } catch {
      return false;
    }
  }

  async unpushed(): Promise<number> {
    try {
      return Number(
        await this.#git("rev-list", "--count", "@{upstream}..HEAD"),
      );
    } catch {
      return 0;
    }
  }
}

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" ? stderr.trim() : "";
}
