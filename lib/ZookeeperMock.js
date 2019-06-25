const EventEmitter = require('events');
const zookeeper = require('node-zookeeper-client');

/**
 * This mock object is to overwrite the zkClient to e.g. simulate race
 * conditions.  It is not complete so far but could be extended.
 * @class
 */
class ZookeeperMock {
    constructor() {
        this._zkState = {
            children: {},
            emitter: new EventEmitter(),
            isSequential: false,
            counter: 0,
        };
    }

    zeroPad(path, n, width) {
        const _n = `${n}`;
        return path + (_n.length >= width ? _n :
                       new Array(width - _n.length + 1).join('0') + _n);
    }

    create(path, data, acls, mode, callback) {
        // console.log('CREATE', path, mode);
        let cur = this._zkState;
        let prev = {};
        let prevName = null;
        let _path = path;
        let _eexist = false;
        path.split('/').forEach((name, idx, array) => {
            const isLast = (idx === array.length - 1);
            // console.log('NAME', name, isLast);
            if (!Object.prototype.hasOwnProperty.call(cur.children, name)) {
                if (isLast && mode ===
                    zookeeper.CreateMode.PERSISTENT_SEQUENTIAL) {
                    cur.children[name] = {};
                    cur.children[name].isSequential = true;
                } else {
                    cur.children[name] = {};
                    cur.children[name].children = {};
                    cur.children[name].emitter = new EventEmitter();
                    cur.children[name].isSequential = false;
                    cur.children[name].counter = 0;
                }
            } else {
                if (isLast) {
                    if (mode !== zookeeper.CreateMode.PERSISTENT_SEQUENTIAL) {
                        _eexist = true;
                    }
                }
            }
            prev = cur;
            prevName = name;
            cur = cur.children[name];
        });
        if (_eexist) {
            return callback(
                new zookeeper.Exception(zookeeper.Exception.NODE_EXISTS,
                                        'NODE_EXISTS',
                                        path,
                                        this.create));
        }
        // console.log('PREV', prev, 'NAME', prevName);
        if (mode === zookeeper.CreateMode.PERSISTENT_SEQUENTIAL) {
            _path = this.zeroPad(path, prev.counter, 10);
            prevName = this.zeroPad(prevName, prev.counter, 10);
            prev.children[prevName] = {};
            prev.counter++;
        }
        // console.log('_PATH', _path);
        prev.children[prevName].data = data;
        prev.children[prevName].acls = acls;
        prev.children[prevName].mode = mode;
        prev.emitter.emit('NODE_CHILDREN_CHANGED', {});
        return process.nextTick(() => callback(null, _path));
    }

    _getZNode(path) {
        let next = this._zkState;
        let prev = {};
        let prevName = null;
        path.split('/').forEach(name => {
            prev = next;
            prevName = name;
            next = next.children[name];
        });
        return { prev, prevName };
    }

    setData(path, data, version, callback) {
        if (!callback) {
            // eslint-disable-next-line
            callback = version;
            // eslint-disable-next-line
            version = -1;
        }
        const { prev, prevName } = this._getZNode(path);
        prev.children[prevName].data = data;
        return process.nextTick(() => callback(null, {}));
    }

    getData(path, watcher, callback) {
        if (!callback) {
            // eslint-disable-next-line
            callback = watcher;
            // eslint-disable-next-line
            watcher = undefined;
        }
        const { prev, prevName } = this._getZNode(path);
        return process.nextTick(
            () => callback(null, prev.children[prevName].data, {}));
    }

    getChildren(path, watcher, callback) {
        if (!callback) {
            // eslint-disable-next-line
            callback = watcher;
            // eslint-disable-next-line
            watcher = undefined;
        }
        const children = [];
        const { prev, prevName } = this._getZNode(path);
        if (watcher) {
            prev.children[prevName].emitter.once(
                'NODE_CHILDREN_CHANGED',
                event => watcher(event));
        }
        Object.entries(prev.children[prevName].children).forEach(kv => {
            if (!kv[1].isSequential) {
                children.push(kv[0]);
            }
        });
        return process.nextTick(() => callback(null, children, {}));
    }

    removeRecur(path, callback) {
        const { prev, prevName } = this._getZNode(path);
        delete prev[prevName];
        return process.nextTick(() => callback());
    }
}

module.exports = ZookeeperMock;