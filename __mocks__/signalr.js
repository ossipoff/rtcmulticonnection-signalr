const LogLevel = { Error: 0, Warning: 1, Information: 2, Trace: 3 }

// Shared state accessible by tests
let _hubs = []

class HubConnectionBuilder {
  constructor() {
    this.url = null
    this.loggingLevel = null
    this.autoReconnect = false
    this._builtHub = null
  }
  withUrl(url) { this.url = url; return this }
  withAutomaticReconnect() { this.autoReconnect = true; return this }
  configureLogging(level) { this.loggingLevel = level; return this }
  build() {
    const hub = new HubConnection(this.url, this.loggingLevel, this.autoReconnect)
    this._builtHub = hub
    _hubs.push(hub)
    return hub
  }
}

class HubConnection {
  constructor(url, loggingLevel, autoReconnect) {
    this.url = url
    this.loggingLevel = loggingLevel
    this.autoReconnect = autoReconnect
    this._handlers = {}
    this._invokeCalls = []
    this.startPromiseResolve = null
    this.startPromise = new Promise((resolve) => { this.startPromiseResolve = resolve })
    this.start = jest.fn(() => this.startPromise)
    this.stop = jest.fn(() => Promise.resolve())
  }
  on(eventName, handler) { this._handlers[eventName] = handler }
  invoke(methodName, ...args) {
    this._invokeCalls.push([methodName, ...args])
    return Promise.resolve()
  }
}

// Expose via prototype so tests can access after destructuring
HubConnectionBuilder.getHubs = () => [..._hubs]
HubConnectionBuilder.reset = () => { _hubs = [] }

module.exports = { HubConnectionBuilder, LogLevel }
