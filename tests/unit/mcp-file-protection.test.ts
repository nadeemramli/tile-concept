import { describe, expect, it } from "vitest";
import { windowsAclProblems } from "../../scripts/mcp/file-protection.mts";

// Shapes of `icacls <file>` output on Windows 10/11 (synthetic account names).
const file = "C:\\Users\\Synthetic\\AppData\\Roaming\\tile-concept\\mcp-session.json";
const user = { name: "Synthetic", qualified: "DESKTOP-TEST\\Synthetic" };
const icacls = (...aces: string[]) =>
  `${file} ${aces[0]}\r\n${aces.slice(1).map((a) => `${" ".repeat(file.length + 1)}${a}`).join("\r\n")}\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n`;

describe("Windows session-file ACL check", () => {
  it("accepts a file only the user (plus SYSTEM/Administrators) can open", () => {
    expect(windowsAclProblems(icacls("DESKTOP-TEST\\Synthetic:(F)"), file, user)).toEqual([]);
    expect(windowsAclProblems(icacls("DESKTOP-TEST\\Synthetic:(F)", "NT AUTHORITY\\SYSTEM:(I)(F)", "BUILTIN\\Administrators:(I)(F)"), file, user)).toEqual([]);
  });

  it("names every other principal that can read it", () => {
    expect(windowsAclProblems(icacls("DESKTOP-TEST\\Synthetic:(F)", "Everyone:(R)", "BUILTIN\\Users:(I)(RX)", "NT AUTHORITY\\Authenticated Users:(I)(M)", "DESKTOP-TEST\\Other:(R)"), file, user))
      .toEqual(["Everyone", "BUILTIN\\Users", "NT AUTHORITY\\Authenticated Users", "DESKTOP-TEST\\Other"]);
  });

  it("does not mistake the drive letter in the path for a principal, or a built-in group named like the user", () => {
    expect(windowsAclProblems(icacls("NT AUTHORITY\\SYSTEM:(F)"), file, user)).toEqual([]);
    expect(windowsAclProblems(icacls("BUILTIN\\Synthetic:(R)"), file, user)).toEqual(["BUILTIN\\Synthetic"]);
  });
});
