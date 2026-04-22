import mineflayer from 'mineflayer';
import pathfinderPlugin from 'mineflayer-pathfinder';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = pathfinderPlugin;

const config = JSON.parse(readFileSync('./config.json', 'utf8'));

const bot = mineflayer.createBot({
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

let isReady = false;
let afkInterval = null;

bot.once('spawn', () => {
  console.log('[✓] Бот заспавнился на сервере');
  
  isReady = true;
  
  handleMenuSelection();
  
  setTimeout(() => {
    walkForwardAndOpenMenu();
  }, 2000);
});


let menuOpened = false;
let menuCheckTimeout = null;

function walkForwardAndOpenMenu() {
  console.log('[→] Иду вперед 3 блока...');
  
  const startPos = bot.entity.position.clone();
  bot.setControlState('forward', true);
  
  const checkDistance = setInterval(() => {
    const distance = bot.entity.position.distanceTo(startPos);
    if (distance >= 3) {
      bot.setControlState('forward', false);
      clearInterval(checkDistance);
      console.log('[✓] Прошел 3 блока');
      
      setTimeout(() => {
        tryClickNPC();
      }, 500);
    }
  }, 50);
  
  setTimeout(() => {
    bot.setControlState('forward', false);
    clearInterval(checkDistance);
  }, 5000);
}

function tryClickNPC() {
  console.log('[→] Пробую открыть меню...');
  
  // Пробуем найти NPC
  const entities = Object.values(bot.entities);
  const npcInFront = entities.find(entity => {
    if (entity.type === 'living' && entity.name === 'armor_stand') {
      const distance = bot.entity.position.distanceTo(entity.position);
      if (distance < 5) {
        console.log(`[i] Найден armor_stand на расстоянии ${distance.toFixed(2)} блоков`);
        return true;
      }
    }
    return false;
  });
  
  if (npcInFront) {
    console.log('[→] Кликаю на NPC...');
    bot.activateEntity(npcInFront);
  }
  
  // Также пробуем просто ПКМ в воздух
  setTimeout(() => {
    console.log('[→] Пробую ПКМ в воздух...');
    bot.swingArm('right');
  }, 200);
  
  menuCheckTimeout = setTimeout(() => {
    if (!menuOpened) {
      console.log('[!] Меню не открылось за 3 секунды, иду еще на 1 блок...');
      walkOneBlockForward();
    }
  }, 3000);
}

function walkOneBlockForward() {
  const startPos = bot.entity.position.clone();
  bot.setControlState('forward', true);
  
  const checkDistance = setInterval(() => {
    const distance = bot.entity.position.distanceTo(startPos);
    if (distance >= 1) {
      bot.setControlState('forward', false);
      clearInterval(checkDistance);
      console.log('[✓] Прошел еще 1 блок');
      
      setTimeout(() => {
        tryClickNPC();
      }, 500);
    }
  }, 50);
  
  setTimeout(() => {
    bot.setControlState('forward', false);
    clearInterval(checkDistance);
  }, 2000);
}

function handleMenuSelection() {
  console.log('[i] Обработчик меню зарегистрирован');
  
  bot.on('windowOpen', (window) => {
    console.log(`[✓] ОТКРЫТО ОКНО: "${window.title}" (тип: ${window.type})`);
    
    menuOpened = true;
    if (menuCheckTimeout) {
      clearTimeout(menuCheckTimeout);
    }
    
    // Проверяем любое окно с инвентарем
    if (window.type === 'minecraft:generic_9x3' || 
        window.type === 'minecraft:chest' ||
        window.title.includes('Выбери') || 
        window.title.includes('сервер') ||
        window.title.includes(config.menuSettings.windowTitle)) {
      console.log('[→] Это меню выбора! Кликаю на слот...');
      
      setTimeout(() => {
        try {
          bot.clickWindow(config.menuSettings.slotToClick, 0, 0);
          console.log(`[✓] Кликнул на слот ${config.menuSettings.slotToClick}`);
          
          setTimeout(() => {
            bot.closeWindow(window);
            console.log('[✓] Закрыл меню');
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
  console.log('[AFK] Режим AFK активирован');
  
  if (config.afkSettings.antiKick) {
    afkInterval = setInterval(() => {
      if (config.afkSettings.lookAround) {
        bot.look(bot.entity.yaw + (Math.random() - 0.5) * 0.1, 
                 bot.entity.pitch + (Math.random() - 0.5) * 0.1);
      }
    }, config.afkSettings.moveInterval);
  }
}

bot.on('kicked', (reason) => {
  console.log('[✗] Кикнут:', reason);
  cleanup();
});

bot.on('error', (err) => {
  console.error('[✗] Ошибка:', err.message);
});

bot.on('end', () => {
  console.log('[✗] Соединение закрыто');
  cleanup();
});

function cleanup() {
  if (afkInterval) clearInterval(afkInterval);
}

process.on('SIGINT', () => {
  console.log('\n[!] Остановка бота...');
  cleanup();
  bot.quit();
  process.exit(0);
});
