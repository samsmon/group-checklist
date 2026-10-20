'use strict';

// WebSocket Alpine methods — merged into the app data object in app.js
const _wsMethods = {

  connectWs(slug) {
    if (this.wsSlug === slug && this.ws?.readyState === WebSocket.OPEN) return;
    this.disconnectWs(this.wsSlug !== slug); // keep the offline/dropped state while retrying the same room
    this.wsSlug = slug;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${slug}`);
    this.ws = ws;

    ws.onopen = () => {
      console.log('[ws] connected:', slug);
      ws._ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25000);
      clearTimeout(this._offlineTimer);
      this._offlineTimer = null;
      this._wsFails = 0;
      this.wsOffline = false;
      // Events sent while we were disconnected are gone: reload what the server has now
      if (this._wsDropped) {
        this._wsDropped = false;
        this.refreshItems();
        this.loadMessages();
      }
    };

    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      try {
        const { event, data } = JSON.parse(e.data);
        this.handleWsEvent(event, data);
      } catch { /* ignore */ }
    };

    ws.onclose = (e) => {
      clearInterval(ws._ping);
      if (this.wsSlug !== slug) return;

      // The server closed us on purpose (project turned private or was deleted): do not retry
      if (e.code === 4403 || e.code === 4404) {
        if (this._deletingSlug !== slug) {
          this.showToast(e.code === 4403 ? 'This checklist is now private.' : 'This checklist was deleted.', 'error');
        }
        this.closeModal(); // a dialog for a project we can no longer see is moot
        this._leaveProject();
        return;
      }

      this._wsDropped = true;
      // Show "reconnecting" only if the drop lasts, so short blips do not flicker
      if (!this._offlineTimer) this._offlineTimer = setTimeout(() => { this.wsOffline = true; }, 2000);
      // Back off 3s, 6s, 12s ... up to 30s so a server that rejects us is not hammered
      this._wsFails = (this._wsFails || 0) + 1;
      const delay = Math.min(30000, 3000 * 2 ** Math.min(this._wsFails - 1, 4));
      setTimeout(() => { if (this.wsSlug === slug) this.connectWs(slug); }, delay);
    };

    ws.onerror = (e) => console.error('[ws] error:', e);
  },

  disconnectWs(reset = true) {
    if (reset) {
      clearTimeout(this._offlineTimer);
      this._offlineTimer = null;
      this._wsDropped = false;
      this._wsFails = 0;
      this.wsOffline = false;
    }
    if (this.ws) {
      clearInterval(this.ws._ping);
      this.wsSlug = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  },

  handleWsEvent(event, data) {
    const refreshLogs = () => {
      if (this.activeProject?.is_owner && this.rightTab === 'log') this.loadLogs();
    };
    switch (event) {
      case 'item.created':
        if (!this.items.find(i => i.id === data.id)) this.items.push(data);
        refreshLogs();
        break;
      case 'item.updated': {
        const idx = this.items.findIndex(i => i.id === data.id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], ...data };
        refreshLogs();
        break;
      }
      case 'item.deleted':
        this.items = this.items.filter(i => i.id !== data.id);
        if (this.commentPopup.visible && this.commentPopup.item?.id === data.id) this.closeCommentPopup();
        refreshLogs();
        break;
      case 'item.reordered': {
        const map = Object.fromEntries(data.order.map(o => [o.id, o.display_order]));
        this.items = [...this.items]
          .map(i => ({ ...i, display_order: map[i.id] ?? i.display_order }))
          .sort((a, b) => a.display_order - b.display_order);
        break;
      }
      case 'item.completed': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: data.completion };
        refreshLogs();
        break;
      }
      case 'item.uncompleted': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: null };
        refreshLogs();
        break;
      }
      case 'item.pic_added': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1 && !(this.items[idx].pics ?? []).find(p => p.id === data.pic.id)) {
          this.items[idx] = { ...this.items[idx], pics: [...(this.items[idx].pics ?? []), data.pic] };
        }
        refreshLogs();
        break;
      }
      case 'item.pic_removed': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], pics: this.items[idx].pics.filter(p => p.id !== data.pic_id) };
        refreshLogs();
        break;
      }
      case 'comment.added': {
        if (this.commentPopup.visible && this.commentPopup.item?.id === data.item_id) {
          if (!this.commentPopup.comments.find(c => c.id === data.id)) {
            this.commentPopup = { ...this.commentPopup, comments: [...this.commentPopup.comments, data] };
          }
        }
        break;
      }
      case 'comment.deleted': {
        if (this.commentPopup.visible && this.commentPopup.item?.id === data.item_id) {
          this.commentPopup = { ...this.commentPopup, comments: this.commentPopup.comments.filter(c => c.id !== data.comment_id) };
        }
        break;
      }
      case 'message.created':
        if (!this.messages.find(m => m.id === data.id)) {
          this.messages.push(data);
          setTimeout(() => {
            const el = document.getElementById('chat-messages');
            if (el) el.scrollTop = el.scrollHeight;
          }, 50);
        }
        break;
      case 'project.updated':
        if (this.activeProject) this.activeProject = { ...this.activeProject, ...data };
        break;
      case 'project.deleted':
        // The person who deleted it already gets "Checklist deleted." from their own request
        if (this._deletingSlug !== data.slug) this.showToast('This checklist has been deleted.', 'error');
        this.closeModal();
        this._leaveProject();
        break;
    }
  },

};
