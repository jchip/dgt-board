//
// Game maintains
// - A chess.js to validate and update moves
// - Two players
// - Game will switch back and forth to wait for move events from each
//   player in turn
// - A player can be an engine, which would wait for player to help move its
//   piece on the DGT board, validate it, and then let game know of its move
// - A player can also have a tutor engine, which helps analyze and offer
//   suggestions
// - If a real player wants to take back a move
// - If a real player made a move before making the engine's move on DGT, then
//   an flag is set.

const utils = require("./utils");
const chess = require("chess.js");
const protocol = require("./protocol.json");
const chalk = require("chalk");

class ChessGame {
  constructor({ board }) {
    this._board = board;
    this._chess = new chess.Chess();
    this._players = false;
  }

  newGame(initPlayer, startFen) {
    // const xt = "rnbqkbnr/ppp2ppp/8/3p4/4p3/3BPN2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
    // const xt = "rnbqk2r/pppp1ppp/3b1n2/4p3/8/3BPN2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
    this._initPlayer = initPlayer;
    this._startFen = startFen || utils.defaultFen;
    const startRaw = utils.fenToRaw(this._startFen).join("");

    const waitStart = () => {
      const boardRaw = this._board.toString();
      console.log("waiting", utils.rawToFen(boardRaw));
      if (boardRaw === startRaw) {
        console.log("board ready");
        this._board.removeListener("changed", waitStart);
        this.readyForNewGame();
        return true;
      } else {
        console.log("wait start", boardRaw, startRaw);
        return false;
      }
    };

    // wait for board to be in start position
    if (!waitStart()) {
      console.log("waiting for board positions to be ready");
      this._board.on("changed", waitStart);
    }
  }

  get turnColor() {
    return this._chess.turn() === this._chess.WHITE ? "white" : "black";
  }

  async syncBoard(color, act, beforeBoard) {
    console.log("fen", this._chess.fen());
    let raw = "";
    const clr = color && color[0];
    const board = this._chess.board();
    board.forEach(row => {
      row.forEach(p => {
        if (p === null) {
          raw += ".";
        } else if (!clr || p.color === clr) {
          raw += p.color === this._chess.WHITE ? p.type.toUpperCase() : p.type.toLowerCase();
        } else {
          raw += ".";
        }
      });
    });

    const isSync = () => {
      return this._board.stringByColor(color) === raw;
    };

    this._board.commit(color, raw);

    let visualMove = "";

    let count = 0;

    const showVisualMove = () => {
      console.log(this._players[color].name, "moved");
      console.log(
        "SAN:",
        chalk.yellow(act.san),
        "position",
        chalk.green(act.from),
        "->",
        chalk.green(act.to),
        "waiting for correct board update",
        count++
      );
      if (!visualMove) {
        const before = beforeBoard.split("\n");
        const after = this._chess.ascii().split("\n");
        for (let ix = 0; ix < before.length; ix++) {
          const br = before[ix];
          const ar = after[ix];
          for (let rx = 0; rx < br.length; rx++) {
            if (br[rx] !== ar[rx]) {
              if (!utils.isEmpty(ar[rx])) {
                visualMove += chalk.magenta(ar[rx]);
              } else {
                visualMove += chalk.cyan(br[rx]);
              }
            } else {
              visualMove += ar[rx];
            }
          }
          visualMove += "\n";
        }
      }
      console.log(visualMove);
    };

    if (!isSync()) {
      let waiting;
      const promise = new Promise(resolve => {
        waiting = { resolve };
      });

      const checkSync = () => {
        if (isSync()) {
          this._board.removeListener("changed", checkSync);
          waiting.resolve();
        } else {
          showVisualMove();
        }
      };

      this._board.on("changed", checkSync);

      showVisualMove();
      await promise;
    }
  }

  async move(m) {
    let chessMove;
    if (typeof m === "string") {
      chessMove = {
        from: m.substr(0, 2),
        to: m.substr(2, 2)
      };
    } else {
      chessMove = {
        from: protocol.fields[m.from.index],
        to: protocol.fields[m.to.index]
      };
    }

    const legal = this._chess.move(chessMove);
    if (legal) {
      // tell board to commit
      // verify board
      // console.log(this._chess.ascii());
    } else {
      // handle illegal move
    }

    return legal;
  }

  fen() {
    return this._chess.fen();
  }

  async waitPlayerTurn(color) {
    const act = await this._players[color].yourTurn();
    const legal = await this.move(act.move);
    if (act.engine) {
      if (!legal) {
        throw new Error("engine made an illegal move");
      }
    } else if (!legal) {
      console.log(
        chalk.green(this._players[color].name),
        chalk.red("made an illegal move, try again please.")
      );
      return await this.waitPlayerTurn(color);
    } else {
      console.log(this._chess.ascii());
    }
    return legal;
  }

  checkEndGame() {
    if (this._chess.in_draw()) {
      console.log("Game is a Draw");
    } else if (this._chess.in_stalemate()) {
      console.log("Game is stalemate");
    } else if (this._chess.in_threefold_repetition()) {
      console.log("Game is in threefold repetition");
    } else if (this._chess.in_checkmate()) {
      console.log("Game over, checkmate");
    } else {
      return false;
    }
    return true;
  }

  async play() {
    const color = this.turnColor;
    const beforeBoard = this._chess.ascii();
    const act = await this.waitPlayerTurn(color);
    await this.syncBoard(color, act, beforeBoard);
    if (!this.checkEndGame()) {
      process.nextTick(() => this.play());
    }
  }

  async readyForNewGame() {
    this._board.reset();
    this._chess.load(this._startFen);
    const black = await this._initPlayer("black", this);
    const white = await this._initPlayer("white", this);
    this._players = { black, white };
    process.nextTick(() => this.play());
  }
}

module.exports = ChessGame;
