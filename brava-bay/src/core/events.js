// Tiny synchronous event bus. See CONTRACT.md for the event catalogue.
export class Events {
	constructor() { this.map = new Map(); }
	/** Subscribe; returns an unsubscribe function. */
	on(name, fn) {
		let list = this.map.get(name);
		if (!list) { list = []; this.map.set(name, list); }
		list.push(fn);
		return () => this.off(name, fn);
	}
	once(name, fn) {
		const off = this.on(name, (p) => { off(); fn(p); });
		return off;
	}
	off(name, fn) {
		const list = this.map.get(name);
		if (!list) return;
		const i = list.indexOf(fn);
		if (i >= 0) list.splice(i, 1);
	}
	emit(name, payload = {}) {
		const list = this.map.get(name);
		if (!list || list.length === 0) return;
		// copy so handlers may unsubscribe while iterating
		for (const fn of list.slice()) {
			try { fn(payload); } catch (e) { console.error(`[events] handler for "${name}" threw`, e); }
		}
	}
}
