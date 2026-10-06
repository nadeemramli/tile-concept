/**
 * Keep the MCP session file readable by its owner only.
 *
 * POSIX: mode 600 (directory 700); a file other users can read is refused.
 * Windows: mode bits mean nothing there, so access is set with icacls:
 * inherited permissions are removed and only the current user is granted
 * access, on the directory (inherited by new files) and on the file after
 * every write. A file whose ACL grants anyone else (Everyone, Users,
 * Authenticated Users, another account) is refused. SYSTEM and
 * Administrators are tolerated: they can read any file on the machine anyway.
 */
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";

const TOLERATED = [/^NT AUTHORITY\\SYSTEM$/i, /^BUILTIN\\Administrators$/i, /^SYSTEM$/i, /^Administrators$/i];

function windowsUser(): { name: string; qualified: string } {
  const name = process.env.USERNAME ?? os.userInfo().username;
  const domain = process.env.USERDOMAIN;
  return { name, qualified: domain ? `${domain}\\${name}` : name };
}

/**
 * Principals in `icacls <file>` output that are neither the current user nor
 * tolerated system accounts. Exported for tests; pure.
 */
export function windowsAclProblems(icaclsOutput: string, file: string, user: { name: string; qualified: string }): string[] {
  const problems: string[] = [];
  for (const raw of icaclsOutput.split(/\r?\n/)) {
    let line = raw;
    if (line.toLowerCase().startsWith(file.toLowerCase())) line = line.slice(file.length);
    const m = /^\s*(.+?):((?:\([^)]*\))+)\s*$/.exec(line);
    if (!m) continue;
    const principal = m[1].trim();
    const isUser = principal.toLowerCase() === user.qualified.toLowerCase() || principal.toLowerCase() === user.name.toLowerCase()
      || principal.toLowerCase().endsWith(`\\${user.name.toLowerCase()}`) && !/^(BUILTIN|NT AUTHORITY)\\/i.test(principal);
    if (isUser || TOLERATED.some((re) => re.test(principal))) continue;
    problems.push(principal);
  }
  return problems;
}

function icacls(args: string[]): string {
  return execFileSync("icacls", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

/** Create the directory so that only its owner can reach it. */
export function ensurePrivateDir(dir: string) {
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32" && !existed) {
    const { qualified } = windowsUser();
    icacls([dir, "/inheritance:r", "/grant:r", `${qualified}:(OI)(CI)F`]);
  }
}

/** Restrict a file to its owner. */
export function protectFile(file: string) {
  if (process.platform === "win32") {
    const { qualified } = windowsUser();
    icacls([file, "/inheritance:r", "/grant:r", `${qualified}:F`]);
  } else {
    fs.chmodSync(file, 0o600);
  }
}

/** Throw unless only the owner (and, on Windows, SYSTEM/Administrators) can read the file. */
export function assertPrivate(file: string) {
  if (process.platform === "win32") {
    let out: string;
    try { out = icacls([file]); } catch (error) {
      throw new Error(`Could not read the permissions of ${file} (${error instanceof Error ? error.message : error}).`);
    }
    const others = windowsAclProblems(out, file, windowsUser());
    if (others.length) {
      throw new Error(`${file} can be read by ${others.join(", ")}. Restrict it to your account: icacls "${file}" /inheritance:r /grant:r "%USERDOMAIN%\\%USERNAME%:F"`);
    }
    return;
  }
  if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error(`${file} is readable by other users. Run: chmod 600 "${file}"`);
}
