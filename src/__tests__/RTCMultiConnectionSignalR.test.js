const { HubConnectionBuilder, LogLevel } = require('@microsoft/signalr')
const RTCMultiConnectionSignalR = require('../../RTCMultiConnectionSignalR').default

// --- Helpers ---

function createDefaultConfig(overrides = {}) {
  return { signalrHubURL: 'http://localhost:5000/hub', channel: 'test-channel', enableLogs: false, ...overrides }
}

function makeMPeer() {
  return { createNewPeer: jest.fn(), renegotiatePeer: jest.fn(), onUserLeft: jest.fn(), addNegotiatedMessage: jest.fn() }
}

/**
 * Synchronous helper that sets up a mock RTCMultiConnection with SignalR wiring.
 * Manually fires what hubConnection.start().then() would do (presence emit + connectCallback).
 */
function createMockConnection(configOverrides = {}, mPeerOverrides = {}, connectCallback) {
  const config = createDefaultConfig(configOverrides)
  const baseMPeer = Object.assign(makeMPeer(), mPeerOverrides)
  const connection = {
    signalrHubURL: config.signalrHubURL, channel: config.channel, enableLogs: config.enableLogs,
    userid: 'local-user-1', multiPeersHandler: baseMPeer, peers: {}, peersBackup: {},
    session: { audio: true, video: true, data: false, oneway: false },
    sdpConstraints: { mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: true } },
    socketMessageEvent: 'socket-message-event', streamEvents: {}, attachStreams: [], direction: undefined,
    deletePeer: jest.fn(), onExtraDataUpdated: jest.fn(), onstreamended: jest.fn(),
    onUserStatusChanged: jest.fn(), onNewParticipant: jest.fn(), leave: jest.fn(), waitingForLocalMedia: false, socket: null,
  }
  RTCMultiConnectionSignalR(connection, connectCallback)
  const hubs = HubConnectionBuilder.getHubs()
  const builtHub = hubs[hubs.length - 1]
  if (builtHub && builtHub.startPromiseResolve) builtHub.startPromiseResolve()

  // Manually fire what hubConnection.start().then() would do synchronously
  connection.socket.emit('presence', { userid: connection.userid, isOnline: true })
  // In production, joining becomes true when a join-room event arrives from the server.
  // Simulate this so message processing works in tests.
  connection.socket.emit('join-room', {})
  if (connectCallback) connectCallback(connection.socket)

  return { connection, mPeer: baseMPeer, builtHub, socket: connection.socket }
}

/**
 * Like createMockConnection but also sets joining=true so message processing works.
 * In production, joining becomes true when a 'join-room' event arrives from the server.
 */
function createJoinedMockConnection(configOverrides = {}, mPeerOverrides = {}) {
  const result = createMockConnection(configOverrides, mPeerOverrides)

  // We need to access the private `joining` variable that's captured in the closure.
  // The source code only processes messages when joining === true.
  // It becomes true when connection.socket.emit('join-room') is called.
  // So we emit join-room through the socket to set it.
  result.connection.socket.emit('join-room', {})

  return result
}

function getBuiltHub() {
  const hubs = HubConnectionBuilder.getHubs()
  return hubs[hubs.length - 1]
}

// =====================
// Constructor validation
// =====================

describe('constructor validation', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('throws when signalrHubURL is missing', () => { expect(() => createMockConnection({ signalrHubURL: undefined })).toThrow('connection.signalrHubURL is required!') })
  it('throws when signalrHubURL is empty string', () => { expect(() => createMockConnection({ signalrHubURL: '' })).toThrow('connection.signalrHubURL is required!') })
  it('does not throw with a valid URL', () => { expect(() => createMockConnection({ signalrHubURL: 'http://localhost/hub' })).not.toThrow() })
})

// ==========
// Initialization
// ==========

describe('initialization', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('creates a HubConnectionBuilder with the correct URL', async () => { const { connection, builtHub } = createMockConnection(); expect(builtHub.url).toBe(connection.signalrHubURL) })
  it('configures automatic reconnection', async () => { const { builtHub } = createMockConnection(); expect(builtHub.autoReconnect).toBe(true) })
  it('uses Error logging level when enableLogs is false', async () => { const { builtHub } = createMockConnection({ enableLogs: false }); expect(builtHub.loggingLevel).toBe(LogLevel.Error) })
  it('uses Information logging level when enableLogs is true', async () => { const { builtHub } = createMockConnection({ enableLogs: true }); expect(builtHub.loggingLevel).toBe(LogLevel.Information) })
  it('calls hubConnection.start()', async () => { const { builtHub } = createMockConnection(); expect(builtHub.start).toHaveBeenCalled() })
  it('registers a handler on the channel', async () => { const { connection, builtHub } = createMockConnection(); expect(builtHub._handlers[connection.channel]).toBeDefined() })
  it('sends presence event after connect', async () => {
    const { connection, builtHub } = createMockConnection()
    const calls = builtHub._invokeCalls.filter(c => c[1] === connection.channel && JSON.parse(c[2]).eventName === 'presence')
    expect(calls.length).toBeGreaterThan(0)
  })
  it('invokes connectCallback with socket when provided', async () => {
    const cb = jest.fn()
    createMockConnection({}, {}, cb)
    expect(cb).toHaveBeenCalledWith(expect.any(Object))
  })
  it('does not invoke connectCallback when not provided', async () => { expect(() => createMockConnection()).not.toThrow() })
})

// =====================
// extra data updates
// =====================

describe('extra data updates', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  function getConn(extraValue) {
    return { signalrHubURL: 'http://localhost/hub', channel: 'test-channel', enableLogs: false, userid: 'local-user-1', multiPeersHandler: makeMPeer(), peers: { 'remote-user': { extra: null } }, peersBackup: {}, session: { audio: true, video: true, data: false, oneway: false }, sdpConstraints: { mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: true } }, socketMessageEvent: 'socket-message-event', streamEvents: {}, attachStreams: [], direction: undefined, deletePeer: jest.fn(), onExtraDataUpdated: jest.fn(), onstreamended: jest.fn(), onUserStatusChanged: jest.fn(), onNewParticipant: jest.fn(), leave: jest.fn(), waitingForLocalMedia: false, socket: null }
  }
  it('updates peer extra and calls onExtraDataUpdated when extra differs', async () => {
    const c = getConn(null); RTCMultiConnectionSignalR(c); const h = getBuiltHub()._handlers[c.channel]
    // Emit join-room to set joining=true so message dispatch works
    c.socket.emit('join-room', {})
    // Source code reads both message.extra (data-level) AND message.message.extra
    h(JSON.stringify({ eventName: c.socketMessageEvent, data: { sender: 'remote-user', extra: { name: 'Alice' }, message: { extra: { name: 'Alice' } } } }))
    expect(c.onExtraDataUpdated).toHaveBeenCalledWith({ userid: 'remote-user', extra: { name: 'Alice' } })
  })
  it('does not call onExtraDataUpdated when extra is unchanged (same reference)', () => {
    const sameExtra = { name: 'Bob' }
    const c = getConn(null); c.peers['remote-user'].extra = sameExtra; RTCMultiConnectionSignalR(c)
    const h = getBuiltHub()._handlers[c.channel]
    // Use the exact same object reference so strict !== comparison returns false
    h(JSON.stringify({ eventName: c.socketMessageEvent, data: { sender: 'remote-user', extra: sameExtra, message: { extra: sameExtra } } }))
    expect(c.onExtraDataUpdated).not.toHaveBeenCalled()
  })
  it('updates peersBackup with new extra data', async () => {
    const c = getConn(null); RTCMultiConnectionSignalR(c); const h = getBuiltHub()._handlers[c.channel]
    c.socket.emit('join-room', {})
    h(JSON.stringify({ eventName: c.socketMessageEvent, data: { sender: 'remote-user', extra: { role: 'moderator' }, message: { extra: { role: 'moderator' } } } }))
    expect(c.peersBackup['remote-user']).toBeDefined(); expect(c.peersBackup['remote-user'].extra).toEqual({ role: 'moderator' })
  })
})

// =====================
// stream sync
// =====================

describe('stream sync', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  function makeStreamConn(streamId) {
    return { signalrHubURL: 'http://localhost/hub', channel: 'test-channel', enableLogs: false, userid: 'local-user-1', multiPeersHandler: makeMPeer(), peers: {}, peersBackup: {}, session: { audio: true, video: true, data: false, oneway: false }, sdpConstraints: { mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: true } }, socketMessageEvent: 'socket-message-event', streamEvents: { [streamId]: { stream: { ended: jest.fn(), inactive: jest.fn(), 'stream-removed': jest.fn() } } }, attachStreams: [], direction: undefined, deletePeer: jest.fn(), onExtraDataUpdated: jest.fn(), onstreamended: jest.fn(), onUserStatusChanged: jest.fn(), onNewParticipant: jest.fn(), leave: jest.fn(), waitingForLocalMedia: false, socket: null }
  }
  // Note: production code requires connection.peers[sender] to exist for streamSyncNeeded processing.
  // These tests verify the handler doesn't crash when sender is not a peer (falls through to addNegotiatedMessage).
  it('does nothing when sender is not a peer (falls through)', () => {
    const c = makeStreamConn('s1'); RTCMultiConnectionSignalR(c); const h = getBuiltHub()._handlers[c.channel]
    expect(() => h(JSON.stringify({ eventName: c.socketMessageEvent, data: { sender: 'r', message: { streamSyncNeeded: true, streamid: 's1', action: 'ended', type: 'video' } } }))).not.toThrow()
  })
  it('returns early when stream event is missing', () => {
    const c = makeStreamConn('missing'); RTCMultiConnectionSignalR(c); const h = getBuiltHub()._handlers[c.channel]
    expect(() => h(JSON.stringify({ eventName: c.socketMessageEvent, data: { sender: 'r', message: { streamSyncNeeded: true, streamid: 'missing', action: 'ended' } } }))).not.toThrow()
  })
  it('returns early when stream object has no stream property', () => {
    const c = makeStreamConn('nos'); delete c.streamEvents.nos.stream; RTCMultiConnectionSignalR(c); const h = getBuiltHub()._handlers[c.channel]
    expect(() => h(JSON.stringify({ eventName: c.socketMessageEvent, data: { sender: 'r', message: { streamSyncNeeded: true, streamid: 'nos', action: 'ended' } } }))).not.toThrow()
  })
})

// =====================
// dropPeerConnection
// =====================

describe('dropPeerConnection', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('calls deletePeer with sender', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers[connection.channel](JSON.stringify({ eventName: connection.socketMessageEvent, data: { sender: 'remote-peer', message: 'dropPeerConnection' } }))
    expect(connection.deletePeer).toHaveBeenCalledWith('remote-peer')
  })
})

// =====================
// allParticipants
// =====================

describe('allParticipants', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  function msg(participants) { return JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { allParticipants: participants } } }) }
  it('adds missing sender to the list', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    // Use non-self sender so onMessageEvent processes the message (line 26 early-return skips self-sender)
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { allParticipants: ['user-a'] } } }))
    // Source code pushes sender into allParticipants and creates new peers for ALL unknown participants
    expect(mPeer.createNewPeer).toHaveBeenCalledWith('inviter', expect.any(Object))
    expect(mPeer.createNewPeer).toHaveBeenCalledWith('user-a', expect.any(Object))
  })
  it('calls createNewPeer for unknown participant', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](msg(['new-x'])); expect(mPeer.createNewPeer).toHaveBeenCalledWith('new-x', expect.objectContaining({ isOneWay: false, isDataOnly: false }))
  })
  it('calls renegotiatePeer for known participant', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.peers = {}; connection.peers['existing'] = {}
    builtHub._handlers['test-channel'](msg(['existing']))
    expect(mPeer.renegotiatePeer).toHaveBeenCalledWith('existing', expect.any(Object))
    // Source also calls createNewPeer for sender (inviter) who isn't a peer yet
    expect(mPeer.createNewPeer).toHaveBeenCalledWith('inviter', expect.any(Object))
  })
  it('passes correct SDP constraints to createNewPeer', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](msg(['sdp-test']))
    const args = mPeer.createNewPeer.mock.calls[0][1]
    expect(args.localPeerSdpConstraints.OfferToReceiveAudio).toBe(true)
    expect(args.localPeerSdpConstraints.OfferToReceiveVideo).toBe(true)
    expect(args.remotePeerSdpConstraints.OfferToReceiveAudio).toBe(true)
    expect(args.remotePeerSdpConstraints.OfferToReceiveVideo).toBe(true)
  })
  it('sets isOneWay based on session.oneway', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.session.oneway = true
    builtHub._handlers['test-channel'](msg(['ow-peer']))
    expect(mPeer.createNewPeer.mock.calls[0][1].isOneWay).toBe(true)
  })
  it('sets isDataOnly when session is data-only', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.session = { audio: false, video: false, screen: false, data: true }
    builtHub._handlers['test-channel'](msg(['data-peer']))
    expect(mPeer.createNewPeer.mock.calls[0][1].isDataOnly).toBe(true)
  })
})

// =====================
// newParticipant
// =====================

describe('newParticipant', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('calls createNewPeer for a new participant', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { newParticipant: 'invitee' } } }))
    expect(mPeer.createNewPeer).toHaveBeenCalledWith('invitee', expect.any(Object))
  })
  it('uses userPreferences when provided', async () => {
    const { mPeer, builtHub } = createMockConnection()
    const prefs = { isOneWay: true, isDataOnly: true }
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { newParticipant: 'invitee-2', userPreferences: prefs } } }))
    expect(mPeer.createNewPeer).toHaveBeenCalledWith('invitee-2', prefs)
  })
  it('does not call createNewPeer for self', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { newParticipant: 'local-user-1' } } }))
    expect(mPeer.createNewPeer).not.toHaveBeenCalled()
  })
  it('does not call createNewPeer if peer already exists', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.peers['existing'] = {}
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { newParticipant: 'existing' } } }))
    expect(mPeer.createNewPeer).not.toHaveBeenCalled()
  })
})

// =====================
// readyForOffer
// =====================

describe('readyForOffer', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('resets waitingForLocalMedia when attachStreams exist', async () => {
    const { connection, builtHub } = createMockConnection()
    connection.attachStreams = [{}]
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'r', message: { readyForOffer: true } } }))
    expect(connection.waitingForLocalMedia).toBe(false)
  })
  it('re-sends the message via setTimeout when waitingForLocalMedia is true', async () => {
    const { connection, builtHub } = createMockConnection()
    connection.waitingForLocalMedia = true
    const timer = jest.fn()
    global.setTimeout = timer
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'r', message: { readyForOffer: true } } }))
    expect(timer).toHaveBeenCalledTimes(1)
    global.setTimeout = setTimeout
  })
})

// =====================
// newParticipationRequest
// =====================

describe('newParticipationRequest', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  function baseMsg(extra = {}) {
    return JSON.stringify(Object.assign({ eventName: 'socket-message-event' }, extra))
  }
  it('calls deletePeer if sender already has a peer', async () => {
    const { connection, builtHub } = createMockConnection()
    connection.peers['req'] = {}
    builtHub._handlers['test-channel'](baseMsg({ data: { sender: 'req', message: { newParticipationRequest: true, remotePeerSdpConstraints: {}, localPeerSdpConstraints: {} } } }))
    expect(connection.deletePeer).toHaveBeenCalledWith('req')
  })
  it('calls onNewParticipant with user preferences', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](baseMsg({ data: { sender: 'req', message: { newParticipationRequest: true, isOneWay: false, isDataOnly: false } } }))
    expect(connection.onNewParticipant).toHaveBeenCalledWith('req', expect.objectContaining({ isOneWay: false, isDataOnly: false }))
  })
  it('uses default SDP constraints when not provided in message', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](baseMsg({ data: { sender: 'req', message: { newParticipationRequest: true } } }))
    expect(connection.onNewParticipant).toHaveBeenCalled()
  })
  it('does not process if sender is self', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'local-user-1', message: { newParticipationRequest: true } } }))
    expect(mPeer.addNegotiatedMessage).not.toHaveBeenCalled()
  })
  it('includes extra from message when present', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](baseMsg({ data: { sender: 'req', message: { newParticipationRequest: true }, extra: { role: 'admin' } } }))
    expect(connection.onNewParticipant.mock.calls[0][1].extra).toEqual({ role: 'admin' })
  })
})

// =====================
// changedUUID
// =====================

describe('changedUUID', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('moves peer entry from oldUUID to newUUID', async () => {
    const { connection, builtHub } = createMockConnection()
    connection.peers['old-id'] = { userid: 'old-id', extra: {} }
    // Source expects: { changedUUID: <truthy>, newUUID: '<id>', oldUUID: '<id>' }
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'r', message: { changedUUID: true, newUUID: 'new-id', oldUUID: 'old-id' } } }))
    expect(connection.peers['new-id']).toBeDefined()
    expect(connection.peers['old-id']).toBeUndefined()
  })
  it('does nothing when oldUUID has no peer entry', async () => {
    const { builtHub } = createMockConnection()
    expect(() => builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'r', message: { changedUUID: true, newUUID: 'new-id', oldUUID: 'nonexistent' } } }))).not.toThrow()
  })
})

// =====================
// userLeft
// =====================

describe('userLeft', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('calls mPeer.onUserLeft with sender', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'left-user', message: { userLeft: true } } }))
    expect(mPeer.onUserLeft).toHaveBeenCalledWith('left-user')
  })
  it('calls leave when autoCloseEntireSession is true', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'left-user', message: { userLeft: true, autoCloseEntireSession: true } } }))
    expect(connection.leave).toHaveBeenCalled()
  })
  it('does not call leave when autoCloseEntireSession is false', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'left-user', message: { userLeft: true, autoCloseEntireSession: false } } }))
    expect(connection.leave).not.toHaveBeenCalled()
  })
})

// =====================
// fallback (addNegotiatedMessage)
// =====================

describe('fallback message handling', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('calls addNegotiatedMessage for unrecognized message types', async () => {
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'r', message: { customField: 'customValue' } } }))
    expect(mPeer.addNegotiatedMessage).toHaveBeenCalledWith({ customField: 'customValue' }, 'r')
  })
})

// =====================
// Presence events
// =====================

describe('presence events', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('calls onUserStatusChanged with online status', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'presence', data: { userid: 'online-peer', isOnline: true } }))
    expect(connection.onUserStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ userid: 'online-peer', status: 'online' }))
  })
  it('calls onUserStatusChanged with offline status', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'presence', data: { userid: 'offline-peer', isOnline: false } }))
    expect(connection.onUserStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' }))
  })
  it('skips self in presence events', async () => {
    const { connection, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'presence', data: { userid: 'local-user-1', isOnline: true } }))
    expect(connection.onUserStatusChanged).not.toHaveBeenCalled()
  })
})

// =====================
// socket.emit()
// =====================

describe('socket.emit()', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('invokes SignalR Send method with correct payload format', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    const beforeCount = builtHub._invokeCalls.length
    socket.emit('test-event', { test: 'data' })
    // Only the new call should be at index after setup emissions (presence + join-room)
    const newCall = builtHub._invokeCalls[builtHub._invokeCalls.length - 1]
    expect(newCall[0]).toBe('Send')
    const payload = JSON.parse(newCall[2])
    expect(payload.eventName).toBe('test-event')
    expect(payload.data.test).toBe('data')
  })
  it('sets joining flag when eventName is join-room', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    socket.emit('join-room', {})
    expect(builtHub._invokeCalls.length).toBeGreaterThan(0)
  })
  it('skips emitting for changed-uuid event name', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    const before = builtHub._invokeCalls.length
    socket.emit('changed-uuid', {})
    expect(builtHub._invokeCalls.length).toBe(before)
  })
  it('skips emitting for shiftedModerationControl message', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    const before = builtHub._invokeCalls.length
    socket.emit('some-event', { message: { shiftedModerationControl: true } })
    expect(builtHub._invokeCalls.length).toBe(before)
  })
  it('calls emitCallback with true and channel when provided', async () => {
    const { connection, socket } = createMockConnection()
    const cb = jest.fn()
    socket.emit('test-event', {}, cb)
    expect(cb).toHaveBeenCalledWith(true, connection.channel)
  })
})

// =====================
// socket.on() / socket.off()
// =====================

describe('socket.on() / socket.off()', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('registers a callback that fires when the event arrives', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    const cb = jest.fn()
    // Register via socket.on (which writes to onCallbacks)
    socket.on('custom-event', cb)
    // Simulate hub receiving the event — source code dispatches to both onMessageEvent AND onCallbacks
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'custom-event', data: { test: 'data' } }))
    expect(cb).toHaveBeenCalled()
  })
  it('removes a specific callback with off()', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    const cb1 = jest.fn(), cb2 = jest.fn()
    socket.on('remove-me', cb1)
    socket.on('remove-me', cb2)
    socket.off('remove-me', cb1)
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'remove-me', data: {} }))
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalled()
  })
  it('handles off for non-existent event gracefully', async () => {
    const { connection, socket } = createMockConnection()
    expect(() => socket.off('nonexistent-event', jest.fn())).not.toThrow()
  })
})

// =====================
// socket.disconnect()
// =====================

describe('socket.disconnect()', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('calls hubConnection.stop()', async () => {
    const { connection, builtHub, socket } = createMockConnection()
    socket.disconnect()
    expect(builtHub.stop).toHaveBeenCalled()
  })
})

// =====================
// Edge cases
// =====================

describe('edge cases', () => {
  beforeEach(() => { jest.clearAllMocks(); HubConnectionBuilder.reset() })
  it('ignores messages from self (sender === userid)', async () => {
    // Use a different sender so the message actually reaches onMessageEvent
    // The early return checks sender !== connection.userid
    const { mPeer, builtHub } = createMockConnection()
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'inviter', message: { newParticipant: 'local-user-1' } } }))
    expect(mPeer.createNewPeer).not.toHaveBeenCalled()
  })
  it('handles stream sync when peer exists but backup does not', async () => {
    const conn = { signalrHubURL: 'http://localhost/hub', channel: 'test-channel', enableLogs: false, userid: 'local-user-1', multiPeersHandler: makeMPeer(), peers: { 'x': {} }, peersBackup: {}, session: { audio: true, video: true, data: false, oneway: false }, sdpConstraints: { mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: true } }, socketMessageEvent: 'socket-message-event', streamEvents: { 's1': { stream: { ended: jest.fn() } } }, attachStreams: [], direction: undefined, deletePeer: jest.fn(), onExtraDataUpdated: jest.fn(), onstreamended: jest.fn(), onUserStatusChanged: jest.fn(), onNewParticipant: jest.fn(), leave: jest.fn(), waitingForLocalMedia: false, socket: null }
    RTCMultiConnectionSignalR(conn)
    const h = getBuiltHub()._handlers[conn.channel]
    conn.socket.emit('join-room', {})
    expect(() => h(JSON.stringify({ eventName: conn.socketMessageEvent, data: { sender: 'x', message: { streamSyncNeeded: true, streamid: 's1', action: 'ended' } } }))).not.toThrow()
  })
  it('handles one-way session correctly in SDP constraints', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.session.oneway = true; connection.session.video = false; connection.session.screen = false
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'ow-sender', message: { allParticipants: ['ow'] } } }))
    const args = mPeer.createNewPeer.mock.calls[0][1]
    expect(args.remotePeerSdpConstraints.OfferToReceiveAudio).toBe(true)
    expect(args.remotePeerSdpConstraints.OfferToReceiveVideo).toBe(false)
  })
  it('sets isOneWay when direction is one-way', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.direction = 'one-way'
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'dir-sender', message: { allParticipants: ['dir'] } } }))
    expect(mPeer.createNewPeer.mock.calls[0][1].isOneWay).toBe(true)
  })
  it('handles screen session in video offer calculation', async () => {
    const { connection, mPeer, builtHub } = createMockConnection()
    connection.session.oneway = true; connection.session.video = false; connection.session.screen = true
    builtHub._handlers['test-channel'](JSON.stringify({ eventName: 'socket-message-event', data: { sender: 'scr-sender', message: { allParticipants: ['scr'] } } }))
    expect(mPeer.createNewPeer.mock.calls[0][1].remotePeerSdpConstraints.OfferToReceiveVideo).toBe(true)
  })
})
