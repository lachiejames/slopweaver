// System Audio Recording ("System Audio Recording Only" in Settings, TCC service kTCCServiceAudioCapture) for the app
// that spawned this: TCC answers for the responsible app, and a child the app spawns is the app's. Electron has no call
// to read or ask it, and coreaudiod asks it the first time a call's audio starts or moves device — synchronously, so an
// unanswered prompt stalls audio in every app — so the permissions guide asks here first (`systemAudioPermission.ts`).
//
//   slopweaver-system-audio preflight   prints granted | denied | not-determined; never prompts
//   slopweaver-system-audio request     raises macOS's prompt when never asked, then prints granted | denied
//
// Exit 0 with one word and a newline on stdout and nothing on stderr; otherwise non-zero with why on stderr. TCC is
// private SPI, so both symbols are looked up at run time and their absence is said, never guessed. Built by
// `yarn native:build` (`src/makeSystemAudioPermission.ts`).
import Foundation

let service = "kTCCServiceAudioCapture" as CFString

func fail(_ why: String) -> Never {
  FileHandle.standardError.write(Data((why + "\n").utf8))
  exit(3)
}

let arguments = CommandLine.arguments.dropFirst()
guard arguments.count == 1, let verb = arguments.first, verb == "preflight" || verb == "request" else {
  fail("usage: slopweaver-system-audio preflight|request")
}

guard let tcc = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW) else {
  fail("this macOS has no TCC framework to ask")
}

func symbol(_ name: String) -> UnsafeMutableRawPointer {
  guard let found = dlsym(tcc, name) else { fail("this macOS has no \(name)") }
  return found
}

typealias Preflight = @convention(c) (CFString, CFDictionary?) -> Int32
typealias Request = @convention(c) (CFString, CFDictionary?, @escaping @convention(block) (Bool) -> Void) -> Void

if verb == "preflight" {
  let answer = unsafeBitCast(symbol("TCCAccessPreflight"), to: Preflight.self)(service, nil)
  switch answer {
  case 0: print("granted")
  case 1: print("denied")
  case 2: print("not-determined")
  default: fail("TCCAccessPreflight answered \(answer), not one of 0, 1, 2")
  }
  exit(0)
}

let request = unsafeBitCast(symbol("TCCAccessRequest"), to: Request.self)
let answered = DispatchSemaphore(value: 0)
var granted = false
request(service, nil) { allowed in
  granted = allowed
  answered.signal()
}
answered.wait()
print(granted ? "granted" : "denied")
exit(0)
