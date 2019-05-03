class Player {
  constructor({ color, game, board, playerInfo }) {
    this._color = color;
    this._game = game;
    this._board = board;
    this._pendingMoves = [];
    this._myTurn = false;
    this.setupMoveListener();
    this._info = playerInfo || {
      firstName: "player",
      lastName: "",
      rating: 0,
      sex: "unknown"
    };
  }

  allowTakeback() {
    return false;
  }

  _isCaptured(move) {
    // TODO
    return false;
  }

  get minTime() {
    return 1;
  }

  set minTime(x) {}

  setupMoveListener() {
    const event = `${this._color}_move`;
    const invalidEvent = `${this._color}_invalid_changes`;

    this._board.on(event, move => {
      if (this._pause) {
        return;
      }

      if (!this._myTurn) {
        // detect if one of my pieces got captured and just ignore
        if (this._isCaptured(move)) {
          return;
        }
        // TODO: strict rule, player violated rule and move before turn
        // TODO: if player is engine, then check if allow take back by other
        // player, and then detect if move is a take back
        if (this.allowTakeback()) {
          this._game.checkTakeback(this._color, move);
        }
        this._pendingMoves.push(move);
      } else if (this._awaitMove) {
        this._awaitMove.resolve(move);
        this._awaitMove = false;
      } else {
        this._pendingMoves.push(move);
      }
    });
  }

  resume() {
    this._pause = false;
    this._interrupt = false;
  }

  pause() {
    this._pause = true;
  }

  reset() {
    this._pause = true;
    this._interrupt = false;
    this._pendingMoves = [];
    if (this._awaitMove) {
      this._awaitMove.resolve("reset");
    }
  }

  interrupt(type) {
    if (this._awaitMove) {
      this._awaitMove.resolve(type);
      this._awaitMove = false;
    } else {
      this._interrupt = type;
    }
  }

  async waitMove() {
    if (this._interrupt) {
      return Promise.resolve(this._interrupt);
    }

    if (this._pendingMoves.length > 0) {
      this._pendingMoves = [];
      // user had already made some moves while waiting
      // so trigger a detect moves action
      process.nextTick(() => this._board.detectMoves());
    }
    return new Promise((resolve, reject) => {
      this._awaitMove = { resolve, reject };
    });
  }

  get name() {
    const fn = this._info.firstName || "";
    const ln = this._info.lastName || "";
    const full = [fn, ln].filter(x => x).join(" ");
    return full || "player";
  }

  get firstName() {
    return this._info.firstName || "";
  }

  get lastName() {
    return this._info.lastName || "";
  }

  async yourTurn() {
    try {
      this._myTurn = true;
      const move = await this.waitMove();
      this._interrupt = false;
      return { move };
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = Player;
