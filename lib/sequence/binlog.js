const { EofPacket, ErrorPacket, ComBinlog, initBinlogPacketClass } = require('../packet');
const Command = require('mysql2/lib/commands/command');

module.exports = function(zongji) {
  const BinlogPacket = initBinlogPacketClass(zongji);

  class Binlog extends Command {
    constructor(callback) {
      super();
      this._callback = callback;
    }

    start() {
      // options include: position / nonBlock / serverId / filename
      let options = zongji.get([
        'serverId', 'position', 'filename', 'nonBlock',
      ]);
      this.emit('packet', new ComBinlog(options));
    }

    determinePacket(firstByte) {
      switch (firstByte) {
      case 0xfe:
        return EofPacket;
      case 0xff:
        return ErrorPacket;
      default:
        return BinlogPacket;
      }
    }

    ['OkPacket']() {
      console.log('Received one OkPacket ...');
    }

    ['BinlogPacket'](packet) {
      if (this._callback) {
        // Check event filtering
        if (zongji._skipEvent(packet.eventName.toLowerCase())) {
          return this._callback.call(this);
        }

        let event, error;
        try {
          event = packet.getEvent();
        } catch (err) {
          error = err;
        }
        this._callback.call(this, error, event);
      }
    }
  }

  return Binlog;
};
