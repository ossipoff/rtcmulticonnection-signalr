# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-file npm package (`@ossisoft/rtcmulticonnection-signalr`) that provides a SignalR-based signaling socket handler for RTCMultiConnection. Source is `RTCMultiConnectionSignalR.js` (ES module); Babel transpiles it to `dist/RTCMMultiConnectionSignalR.js` (CommonJS) for publication.

## Commands

```
npm install        # install dependencies
npm run build      # transpile src -> dist/
npm test           # run Jest test suite (59 tests)
```

## Testing

- **Framework**: Jest 30.4.2 with babel-jest transformer for ES module transpilation.
- **Config**: `jest.config.cjs` — moduleNameMapper intercepts `@microsoft/signalr` → `__mocks__/signalr.js`.
- **Test file**: `src/__tests__/RTCMultiConnectionSignalR.test.js` (~520 lines, 59 tests).
- **Mock**: `__mocks__/signalr.js` — provides `HubConnectionBuilder` and `HubConnection` classes that track hub instances via static `getHubs()`/`reset()` helpers, expose `_handlers` and `_invokeCalls`, and use `startPromiseResolve` to control when `hubConnection.start()` resolves.
- **Key testing patterns**:
  - `joining` flag gates all message processing until `'join-room'` event arrives; test helper must emit it before dispatching messages.
  - Synchronous helpers fire `.then()` callbacks manually instead of relying on microtask flushing (fails in Jest's timer environment).
  - Each invocation of RTCMultiConnectionSignalR captures its own `let joining = false` but shares the same HubConnection object across closures.

## Architecture

- `RTCMultiConnectionSignalR.js` exports a single function that conforms to the RTCMultiConnection custom socket handler interface.
- It creates an `@microsoft/signalr` `HubConnection` pointing at `connection.signalrHubURL`, registers on the SignalR hub named by `connection.channel`, and wires `connection.socket` with `emit()`/`on()`/`off()`/`disconnect()`.
- `onMessageEvent()` (lines 25-168) is the message dispatcher: it inspects `message.message` fields (`newParticipant`, `userLeft`, `changedUUID`, `readyForOffer`, `dropPeerConnection`, `streamSyncNeeded`, etc.) and delegates to `connection.multiPeersHandler` methods (`createNewPeer`, `renegotiatePeer`, `addNegotiatedMessage`, `onUserLeft`).
- The `joining` flag (line 172) gates message processing during the initial handshake to avoid ICE candidate errors.
- Build pipeline: Babel with `@babel/preset-env` (via `babel.config.json`) compiles the ES module to CommonJS in `dist/`.

## Key files

| File | Purpose |
|------|---------|
| `RTCMultiConnectionSignalR.js` | Source — socket handler implementation |
| `dist/RTCMMultiConnectionSignalR.js` | Published build output |
| `src/__tests__/RTCMultiConnectionSignalR.test.js` | Test suite (59 tests) |
| `__mocks__/signalr.js` | SignalR mock for testing |
| `jest.config.cjs` | Jest configuration |
| `package.json` | Package config, deps (`@microsoft/signalr`), peer dep (`rtcmulticonnection`) |
| `babel.config.json` | Babel preset-env config |
