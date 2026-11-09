/**
 * WSClient — WebSocket client with auto-reconnect.
 * Connects to the Python face tracker backend.
 */
export class WSClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.onData = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this._reconnectDelay = 2000;
    this._dead = false;
    this._connect();
  }

  _connect() {
    if (this._dead) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch(e) {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] Connected to', this.url);
      this._reconnectDelay = 2000;
      if (this.onConnect) this.onConnect();
    };

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this.onData) this.onData(data);
      } catch(err) {
        console.warn('[WS] Parse error:', err);
      }
    };

    this.ws.onerror = () => {};

    this.ws.onclose = () => {
      console.log('[WS] Disconnected. Reconnecting in', this._reconnectDelay, 'ms…');
      if (this.onDisconnect) this.onDisconnect();
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    setTimeout(() => this._connect(), this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 10000);
  }

  close() {
    this._dead = true;
    if (this.ws) this.ws.close();
  }
}
