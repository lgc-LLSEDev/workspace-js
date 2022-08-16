/* global ll mc system Format PermType ParamType logger BinaryStream */
// LiteLoaderScript Dev Helper
/// <reference path="C:\Users\Administrator\.vscode\extensions\moxicat.llscripthelper-1.0.1\lib\Library/JS/Api.js" />

import * as fs from 'fs';
import { fromArrayBuffer, Layer, Song } from '@encode42/nbs.js';

const pluginName = 'NbsPlayer';
const pluginDataPath = `plugins/${pluginName}/`;
// const pluginCachePath = `${pluginDataPath}cache/`;

if (!fs.existsSync(pluginDataPath)) fs.mkdirSync(pluginDataPath);
// if (!fs.existsSync(pluginCachePath)) fs.mkdirSync(pluginCachePath);

const {
  Red,
  White,
  Aqua,
  Yellow,
  Green,
  Gray,
  Gold,
  DarkAqua,
  LightPurple,
  DarkGreen,
  DarkBlue,
} = Format;
const builtInInstruments = new Map([
  [0, 'note.harp'],
  [1, 'note.bassattack'],
  [2, 'note.bd'],
  [3, 'note.snare'],
  [4, 'note.hat'],
  [5, 'note.guitar'],
  [6, 'note.flute'],
  [7, 'note.bell'],
  [8, 'note.chime'],
  [9, 'note.xylobone'],
  [10, 'note.iron_xylophone'],
  [11, 'note.cow_bell'],
  [12, 'note.didgeridoo'],
  [13, 'note.bit'],
  [14, 'note.banjo'],
  [15, 'note.pling'],
]);
const playTasks = new Map();

function readNbs(
  name: string,
  callback: (ok: boolean, resultOrError: string | Song | undefined) => any
) {
  const nbsPath = `${pluginDataPath}${name}`;
  fs.readFile(nbsPath, function (err, data) {
    if (err) callback(false, `打开文件出错\n${err.stack}`);
    else
      callback(true, fromArrayBuffer(data.buffer, { ignoreEmptyLayers: true }));
  });
}

function stopPlay(xuid: string): boolean {
  const taskId = playTasks.get(xuid);
  if (taskId) {
    clearInterval(taskId);
    const ret = playTasks.delete(xuid);

    const pl = mc.getPlayer(xuid);
    if (pl) pl.tell(`${Red}■ ${LightPurple}NbsPlayer\n\n`, 4);

    return ret;
  }
  return false;
}

function formatMsTime(msTime: number): string {
  const ms = (msTime % 1000).toString()[0];
  const sec = Math.floor((msTime / 1000) % 60)
    .toString()
    .padStart(2, '0');
  const min = Math.floor(msTime / 1000 / 60).toString();
  return `${min}:${sec}.${ms}`;
}

function getPlaySoundDataPack(
  bs: BinaryStream,
  sound: string,
  position: FloatPos,
  volume: number,
  pitch: number
): Packet {
  bs.reset();

  bs.writeString(sound);
  bs.writeVec3(position);
  bs.writeFloat(volume);
  bs.writeFloat(pitch);

  return bs.createPacket(86);
}

function startPlay(player: Player, nbsName: string) {
  const { xuid } = player;
  const playingTask = playTasks.get(xuid);
  if (playingTask) stopPlay(xuid);

  player.tell(`${Green}解析nbs文件……`, 4);

  readNbs(nbsName, (ok, ret) => {
    if (!ok) {
      player.tell(`${Red}文件转换出错！\n错误原因： ${ret}`, 0);
      return;
    }

    if (!(ret instanceof Song)) return;
    const {
      meta: { name, author, originalAuthor },
      length,
      instruments,
      layers,
      timePerTick,
    } = ret;

    let songDisplayName = Aqua;
    if (name) {
      songDisplayName += name;
      const displayAuthor = originalAuthor || author;
      if (displayAuthor)
        songDisplayName += `${White} - ${Green}${displayAuthor}`;
    } else songDisplayName += nbsName;

    const totalLength = timePerTick * length;
    const totalLengthStr = formatMsTime(totalLength);
    let totalNotes = 0;
    layers.forEach((v) => (totalNotes += v.notes.length));

    let playedNotes = 0;
    const bs = new BinaryStream();
    const startTime = Date.now();

    const task = () => {
      const pl = mc.getPlayer(xuid);
      if (totalNotes - playedNotes === 0 || !pl) {
        stopPlay(xuid);
        return;
      }

      const willPlay: Array<Packet> = [];
      layers.forEach((layer: Layer) => {
        const { notes } = layer;
        const n = notes.shift();
        if (n) {
          const { instrument, velocity, key, pitch: notePitch } = n;
          const { volume } = layer;
          const {
            pitch,
            builtIn,
            meta: { name: insName },
          } = instruments.loaded[instrument];
          const { pos } = pl;

          pos.y += 0.37;
          const finalKey =
            (pitch || 45) + ((key || 45) - 45) + (pitch || 0) / 100;

          willPlay.push(
            getPlaySoundDataPack(
              bs,
              (builtIn ? builtInInstruments.get(instrument) : insName) || '',
              pos,
              ((velocity || 100) / 100) * (volume / 100),
              2 ** (finalKey / 12)
            )
          );
        }
      });

      // const {
      //   pos: { x, y, z },
      // } = pl;
      willPlay.forEach((p) => pl.sendPacket(p));

      const timeSpent = Date.now() - startTime;
      const timeSpentStr = formatMsTime(timeSpent);
      pl.tell(
        `${Green}▶ ${LightPurple}NbsPlayer\n` +
          `${songDisplayName}\n` +
          `${Yellow}${timeSpentStr} ${White}/ ${Gold}${totalLengthStr}` +
          `${Gray} | ` +
          `${Yellow}${playedNotes} ${White}/ ${Gold}${totalNotes}`,
        4
      );
    };

    playTasks.set(xuid, setInterval(task, timePerTick));
  });
}

/**
 * @param {Player} player
 */
function nbsForm(player: Player) {
  const pageMax = 15;
  const musics: Array<string> = [];
  fs.readdirSync(pluginDataPath).forEach((v) => {
    if (v.toLowerCase().endsWith('.nbs')) musics.push(v);
  });

  if (musics.length === 0) {
    player.sendModalForm(
      `${Aqua}${pluginName}`,
      `${Green}插件数据目录内还没有歌曲文件哦！赶快去寻找nbs音乐来播放吧！`,
      `知道了`,
      `知道了`,
      () => {}
    );
    return;
  }

  const search = (param: string) => {
    const paramL = param.toLowerCase().replace(' ', '');
    const result: Array<string> = [];
    musics.forEach((v) => {
      if (v.toLowerCase().replace(' ', '').includes(paramL)) result.push(v);
    });

    let form = mc.newSimpleForm();
    form = form
      .setTitle(`${Aqua}${pluginName}`)
      .setContent(
        `${Green}搜寻到 ${Yellow}${result.length} ${Green}条` +
          `关于 ${Aqua}${param} ${Green}的结果`
      );
    result.forEach((v) => {
      form = form.addButton(`${DarkAqua}${v}`);
    });
    player.sendForm(form, (_, i) => {
      if (i !== null && i !== undefined) {
        startPlay(player, result[i]);
      }
    });
  };

  const sendForm = (page: number) => {
    const maxPage = Math.ceil(musics.length / pageMax);
    const index = pageMax * (page - 1);
    const pageContent = musics.slice(index, index + pageMax);

    let pageUp = false;
    let pageDown = false;
    let form = mc.newSimpleForm();
    form
      .setTitle(`${Aqua}${pluginName}`)
      .setContent(
        `${Green}页数 ${Yellow}${page} ${White}/ ${Gold}${maxPage} ${Gray}| ` +
          `${Green}总数 ${Yellow}${musics.length}`
      )
      .addButton(`${DarkBlue}搜索`)
      .addButton(`${DarkBlue}跳页`);
    if (page > 1) {
      form = form.addButton(`${DarkGreen}<- 上一页`);
      pageUp = true;
    }
    pageContent.forEach((v) => {
      form = form.addButton(`${DarkAqua}${v}`);
    });
    if (page < maxPage) {
      form = form.addButton(`${DarkGreen}下一页 ->`);
      pageDown = true;
    }

    player.sendForm(form, (_, i) => {
      if (i !== null && i !== undefined) {
        if (i === 0) {
          const searchForm = mc
            .newCustomForm()
            .setTitle(`${Aqua}${pluginName}`)
            .addInput('请输入搜索内容');
          player.sendForm(searchForm, (__, data) => {
            if (data) {
              let [param] = data;
              if (param) {
                search(param);
              } else player.tell(`${Red}请输入搜索内容`);
            } else sendForm(page);
          });
          return;
        }

        if (i === 1) {
          if (maxPage < 2) {
            player.sendModalForm(
              `${Aqua}${pluginName}`,
              `${Red}页面总数小于2，无法跳转`,
              `知道了`,
              `知道了`,
              () => sendForm(page)
            );
            return;
          }

          const toPageForm = mc
            .newCustomForm()
            .setTitle(`${Aqua}${pluginName}`)
            .addSlider('请选择跳转到的页数', 1, maxPage, 1, page);
          player.sendForm(toPageForm, (__, data) => {
            if (data) sendForm(data[0]);
            else sendForm(page);
          });
          return;
        }

        let fIndex = i - 2;
        if (pageUp) {
          if (fIndex === 0) {
            sendForm(page - 1);
            return;
          }

          fIndex -= 1;
        }

        if (pageDown) {
          if (fIndex === pageMax) {
            sendForm(page + 1);
            return;
          }
        }

        startPlay(player, pageContent[fIndex]);
      }
    });
  };

  sendForm(1);
}

/**
 * 去两侧引号
 */
function trimQuote(str: string) {
  if (str && str.startsWith('"') && str.endsWith('"'))
    return str.slice(1, str.length - 1);
  return str;
}

(() => {
  const cmd = mc.newCommand('nbsplayer', '来首音乐嘛？', PermType.Any);
  cmd.setAlias('nbs');
  cmd.optional('filename', ParamType.RawText);
  cmd.overload(['filename']);

  cmd.setCallback(
    (
      _: Command,
      origin: CommandOrigin,
      out: CommandOutput,
      result: { filename: string }
    ) => {
      const { player } = origin;
      if (!player) {
        out.error('该命令只能由玩家执行');
        return false;
      }

      const { filename } = result;
      if (filename) {
        const filePath = `${pluginDataPath}${trimQuote(filename)}`;
        if (!fs.existsSync(filePath)) {
          out.error('文件不存在！');
          return false;
        }

        startPlay(player, trimQuote(filename));
        return true;
      }

      nbsForm(player);
      return true;
    }
  );

  cmd.setup();
})();

(() => {
  const cmd = mc.newCommand('nbsplay', '管理员播放指令');
  cmd.mandatory('player', ParamType.Player);
  cmd.mandatory('filename', ParamType.RawText);
  cmd.optional('forcePlay', ParamType.Bool);
  cmd.overload(['player', 'filename', 'forcePlay']);

  cmd.setCallback(
    (_: Command, __: CommandOrigin, out: CommandOutput, result: object) => {
      const { player, filename, forcePlay } = result;
      const filePath = `${pluginDataPath}${trimQuote(filename)}`;
      if (player.length === 0) {
        out.error('玩家不在线');
        return false;
      }

      if (!fs.existsSync(filePath)) {
        out.error('文件不存在！');
        return false;
      }

      player.forEach((p: Player) => {
        if (forcePlay || !playTasks.get(p.xuid)) {
          startPlay(p, filename);
          out.success(`成功为 ${p.name} 播放 ${filename}`);
          return;
        }
        out.error(`玩家 ${p.name} 正在播放中，操作失败`);
      });
      return true;
    }
  );

  cmd.setup();
})();

(() => {
  const cmd = mc.newCommand('nbstop', '停止播放nbs', PermType.Any);

  cmd.setCallback((_: Command, origin: CommandOrigin, out: CommandOutput) => {
    const { player } = origin;
    if (!player) {
      out.error('该命令只能由玩家执行');
      return false;
    }

    if (stopPlay(player.xuid)) return out.success('操作成功');

    out.error('操作失败');
    return false;
  });

  cmd.overload();
  cmd.setup();
})();

(() => {
  const cmd = mc.newCommand('nbsisplaying', '玩家是否正在播放', PermType.Any);

  cmd.setCallback((_: Command, origin: CommandOrigin, out: CommandOutput) => {
    const { player } = origin;
    if (!player) {
      out.error('该命令只能由玩家执行');
      return false;
    }

    if (playTasks.get(player.xuid)) return out.success('true');

    out.error('false');
    return false;
  });

  cmd.overload();
  cmd.setup();
})();

mc.listen('onLeft', (pl: Player) => stopPlay(pl.xuid));

ll.registerPlugin(pluginName, '在服务器播放NBS音乐！', [1, 0, 0], {
  Author: 'student_2333',
  License: 'Apache-2.0',
});
