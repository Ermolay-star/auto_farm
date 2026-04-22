import mineflayer from 'mineflayer';
import pathfinderPlugin from 'mineflayer-pathfinder';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = pathfinderPlugin;
const minecraftData = require('minecraft-data');

const config = JSON.parse(readFileSync('./config.json', 'utf8'));

let bot;
let afkInterval = null;
let menuOpened = false;
let menuCheckTimeout = null;
let reconnectTimeout = null;

function startBot() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
  
  console.log(`[i] Подключение к ${config.host}:${config.port} как ${config.username}...`);
  
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth,
    hideErrors: false,
    checkTimeoutInterval: 60000,
    viewDistance: 'tiny'
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log('[✓] Бот заспавнился на сервере');
    handleMenuSelection();

    setTimeout(() => {
      executeJoinStrategy();
    }, 2000);
  });

  bot.on('kicked', (reason) => {
    console.log('[✗] Кикнут:', reason);
    handleReconnect();
  });

  bot.on('error', (err) => {
    console.error('[✗] Ошибка:', err.message);
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        handleReconnect();
    }
  });

  bot.on('end', () => {
    console.log('[✗] Соединение закрыто');
    handleReconnect();
  });
}

function handleReconnect() {
  cleanup();
  if (config.autoReconnect && !reconnectTimeout) {
    console.log(`[i] Повторное подключение через ${config.reconnectDelay / 1000} секунд...`);
    reconnectTimeout = setTimeout(startBot, config.reconnectDelay);
  }
}

function executeJoinStrategy() {
  console.log(`[→] Стратегия входа: ${config.joinStrategy}`);
  
  switch (config.joinStrategy) {
    case 'npc':
      findAndInteractWithNPC();
      break;
    case 'command':
      bot.chat(config.joinCommand);
      console.log(`[✓] Отправлена команда: ${config.joinCommand}`);
      break;
    case 'item':
      bot.setQuickBarSlot(config.joinItemSlot);
      bot.activateItem();
      console.log(`[✓] Использован предмет в слоте ${config.joinItemSlot}`);
      break;
    default:
      console.log('[!] Стратегия не распознана, перехожу в AFK');
      startAFK();
  }
}

function findAndInteractWithNPC() {
  const npcName = config.npcSettings.npcName.toLowerCase();
  console.log(`[i] Поиск NPC: "${npcName}"...`);

  const npc = bot.nearestEntity(entity => {
    if (entity.type === 'player' || entity.type === 'living' || entity.type === 'armor_stand') {
      const dist = bot.entity.position.distanceTo(entity.position);
      if (dist > config.npcSettings.searchRadius) return false;

      const name = (entity.username || entity.displayName || '').toLowerCase();
      if (name.includes(npcName)) return true;

      // Проверка метаданных (для некоторых серверов)
      if (entity.metadata) {
          for (const val of Object.values(entity.metadata)) {
              if (typeof val === 'string' && val.toLowerCase().includes(npcName)) return true;
              if (val && typeof val === 'object' && val.text && val.text.toLowerCase().includes(npcName)) return true;
          }
      }
    }
    return false;
  });

  if (npc) {
    const dist = bot.entity.position.distanceTo(npc.position);
    console.log(`[✓] NPC найден на расстоянии ${dist.toFixed(2)}`);

    const mcData = minecraftData(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    bot.pathfinder.setGoal(new goals.GoalFollow(npc, 2));

    const reachCheck = setInterval(() => {
      if (!bot.entity || !npc.position) {
          clearInterval(reachCheck);
          return;
      }

      if (bot.entity.position.distanceTo(npc.position) <= 3) {
        clearInterval(reachCheck);
        bot.pathfinder.setGoal(null);
        console.log('[→] Кликаю на NPC...');
        bot.activateEntity(npc);

        menuCheckTimeout = setTimeout(() => {
          if (!menuOpened) {
            console.log('[!] Меню не открылось, пробую еще раз...');
            bot.activateEntity(npc);
          }
        }, 3000);
      }
    }, 500);
  } else {
    console.log('[✗] NPC не найден. Использую запасной вариант (иду вперед)...');
    walkForwardFallback();
  }
}

function walkForwardFallback() {
  const startPos = bot.entity.position.clone();
  bot.setControlState('forward', true);
  
  const checkDistance = setInterval(() => {
    if (!bot.entity) {
        clearInterval(checkDistance);
        return;
    }
    const distance = bot.entity.position.distanceTo(startPos);
    if (distance >= 3) {
      bot.setControlState('forward', false);
      clearInterval(checkDistance);
      bot.swingArm('right');
      console.log('[✓] Прошел 3 блока');
    }
  }, 50);
  
  setTimeout(() => {
      bot.setControlState('forward', false);
      clearInterval(checkDistance);
  }, 5000);
}

function handleMenuSelection() {
  bot.on('windowOpen', (window) => {
    const title = window.title ? window.title.toLowerCase() : '';
    const configTitle = config.menuSettings.windowTitle.toLowerCase();
    
    console.log(`[✓] Открыто меню: "${window.title}"`);
    
    if (title.includes(configTitle) || title.includes('выбор') || title.includes('сервер') || title.includes('select')) {
      menuOpened = true;
      if (menuCheckTimeout) clearTimeout(menuCheckTimeout);
      
      console.log(`[→] Кликаю на слот ${config.menuSettings.slotToClick}...`);
      setTimeout(() => {
        try {
          bot.clickWindow(config.menuSettings.slotToClick, 0, 0);
          console.log('[✓] Клик выполнен');
          setTimeout(() => {
            if (bot.currentWindow) bot.closeWindow(window);
            startAFK();
          }, 1000);
        } catch (err) {
          console.error('[✗] Ошибка клика:', err.message);
        }
      }, 500);
    }
  });
}

function startAFK() {
  if (afkInterval) return;
  console.log('[AFK] Режим AFK активирован');
  
  afkInterval = setInterval(() => {
    if (config.afkSettings.antiKick) {
      if (config.afkSettings.lookAround && bot.entity) {
        bot.look(bot.entity.yaw + (Math.random() - 0.5) * 0.5,
                 bot.entity.pitch + (Math.random() - 0.5) * 0.2);
      }
    }
  }, config.afkSettings.moveInterval);
}

function cleanup() {
  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }
  menuOpened = false;
  if (menuCheckTimeout) {
      clearTimeout(menuCheckTimeout);
      menuCheckTimeout = null;
  }
}

process.on('SIGINT', () => {
  console.log('\n[!] Остановка бота...');
  cleanup();
  if (bot) bot.quit();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('[!] Критическая ошибка:', err);
    handleReconnect();
});

startBot();
