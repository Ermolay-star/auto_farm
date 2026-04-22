import mineflayer from 'mineflayer';
import pathfinderPlugin from 'mineflayer-pathfinder';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import fetch from 'node-fetch';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = pathfinderPlugin;
const minecraftData = require('minecraft-data');

const config = JSON.parse(readFileSync('./config.json', 'utf8'));

let bot;
let afkInterval = null;
let menuOpened = false;
let menuCheckTimeout = null;
let reconnectTimeout = null;

const log = {
    info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
    success: (msg) => console.log(`\x1b[32m[✓]\x1b[0m ${msg}`),
    warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
    error: (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
    chat: (user, msg) => console.log(`\x1b[35m[ЧАТ] ${user}:\x1b[0m ${msg}`),
    whisper: (user, msg) => console.log(`\x1b[35m[ЛС] ${user}:\x1b[0m ${msg}`)
};

async function sendToDiscord(message) {
    if (!config.discordWebhook) return;
    try {
        await fetch(config.discordWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
    } catch (err) {
        log.error(`Discord Webhook error: ${err.message}`);
    }
}

function startBot() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = null;

    log.info(`Подключение к ${config.host}:${config.port} как ${config.username}...`);

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
        log.success('Бот заспавнился на сервере');
        sendToDiscord(`✅ Бот **${config.username}** заспавнился на сервере **${config.host}**`);
        handleMenuSelection();

        setTimeout(() => {
            executeJoinStrategy();
        }, 2000);
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        log.chat(username, message);
        sendToDiscord(`💬 **${username}**: ${message}`);

        // Auto-login/register
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('/login') || lowerMsg.includes('/reg') || lowerMsg.includes('войдите') || lowerMsg.includes('регистрация')) {
            if (config.password) {
                bot.chat(`/login ${config.password}`);
                bot.chat(`/register ${config.password} ${config.password}`);
                log.info('Отправлена попытка входа/регистрации');
            }
        }
    });

    bot.on('whisper', (username, message) => {
        log.whisper(username, message);
        sendToDiscord(`🔒 **${username} (PM)**: ${message}`);
    });

    bot.on('health', () => {
        if (config.afkSettings.autoEat) {
            autoEat();
        }
    });

    bot.on('kicked', (reason) => {
        log.error(`Кикнут: ${reason}`);
        sendToDiscord(`❌ Бот кикнут: ${reason}`);
        handleReconnect();
    });

    bot.on('error', (err) => {
        log.error(`Ошибка: ${err.message}`);
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            handleReconnect();
        }
    });

    bot.on('end', () => {
        log.warn('Соединение закрыто');
        handleReconnect();
    });
}

function handleReconnect() {
    cleanup();
    if (config.autoReconnect && !reconnectTimeout) {
        log.info(`Повторное подключение через ${config.reconnectDelay / 1000} секунд...`);
        reconnectTimeout = setTimeout(startBot, config.reconnectDelay);
    }
}

async function autoEat() {
    if (bot.food < 15) {
        const food = bot.inventory.items().find(item => item.name.includes('apple') || item.name.includes('bread') || item.name.includes('steak') || item.name.includes('cooked'));
        if (food) {
            try {
                await bot.equip(food, 'hand');
                await bot.consume();
                log.info(`Съел ${food.name}`);
            } catch (err) {
                log.error(`Ошибка при поедании: ${err.message}`);
            }
        }
    }
}

function executeJoinStrategy() {
    log.info(`Стратегия входа: ${config.joinStrategy}`);

    switch (config.joinStrategy) {
        case 'npc':
            findAndInteractWithNPC();
            break;
        case 'command':
            bot.chat(config.joinCommand);
            log.success(`Отправлена команда: ${config.joinCommand}`);
            break;
        case 'item':
            bot.setQuickBarSlot(config.joinItemSlot);
            bot.activateItem();
            log.success(`Использован предмет в слоте ${config.joinItemSlot}`);
            break;
        default:
            log.warn('Стратегия не распознана, перехожу в AFK');
            startAFK();
    }
}

function findAndInteractWithNPC() {
    const npcName = config.npcSettings.npcName.toLowerCase();
    log.info(`Поиск NPC: "${npcName}"...`);

    let npc = bot.nearestEntity(entity => {
        if (entity.type === 'player' || entity.type === 'living' || entity.type === 'armor_stand') {
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist > config.npcSettings.searchRadius) return false;

            const name = (entity.username || entity.displayName || '').toLowerCase();
            if (name.includes(npcName)) return true;

            if (entity.metadata) {
                for (const meta of Object.values(entity.metadata)) {
                    if (!meta) continue;
                    const val = meta.value || meta;
                    if (typeof val === 'string' && val.toLowerCase().includes(npcName)) return true;
                    if (val && typeof val === 'object' && JSON.stringify(val).toLowerCase().includes(npcName)) return true;
                }
            }
        }
        return false;
    });

    if (!npc) {
        npc = bot.nearestEntity(entity => {
            if (entity.type === 'player' || entity.type === 'living' || entity.type === 'armor_stand') {
                const dist = bot.entity.position.distanceTo(entity.position);
                if (dist > 5) return false;
                const yaw = Math.atan2(entity.position.x - bot.entity.position.x, entity.position.z - bot.entity.position.z);
                const yawDiff = Math.abs(bot.entity.yaw - yaw);
                return yawDiff < 0.5;
            }
            return false;
        });
        if (npc) log.info('NPC найден по расположению (прямо перед ботом)');
    }

    if (npc) {
        const dist = bot.entity.position.distanceTo(npc.position);
        log.success(`NPC найден на расстоянии ${dist.toFixed(2)}`);

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
                log.info('Кликаю на NPC...');
                bot.activateEntity(npc);

                menuCheckTimeout = setTimeout(() => {
                    if (!menuOpened) {
                        log.warn('Меню не открылось, пробую еще раз...');
                        bot.activateEntity(npc);
                    }
                }, 3000);
            }
        }, 500);
    } else {
        log.error('NPC не найден. Использую запасной вариант (иду вперед)...');
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
            bot.activateItem();
            log.success('Прошел 3 блока и кликнул');
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

        log.success(`Открыто меню: "${window.title}"`);

        if (title.includes(configTitle) || title.includes('выбор') || title.includes('сервер') || title.includes('select')) {
            menuOpened = true;
            if (menuCheckTimeout) clearTimeout(menuCheckTimeout);

            log.info(`Кликаю на слот ${config.menuSettings.slotToClick}...`);
            setTimeout(() => {
                try {
                    bot.clickWindow(config.menuSettings.slotToClick, 0, 0);
                    log.success('Клик выполнен');
                    setTimeout(() => {
                        if (bot.currentWindow) bot.closeWindow(window);
                        startAFK();
                    }, 1000);
                } catch (err) {
                    log.error(`Ошибка клика: ${err.message}`);
                }
            }, 500);
        }
    });
}

function startAFK() {
    if (afkInterval) return;
    log.info('Режим AFK активирован');

    afkInterval = setInterval(() => {
        if (config.afkSettings.antiKick) {
            if (bot.entity) {
                if (config.afkSettings.lookAround) {
                    bot.look(bot.entity.yaw + (Math.random() - 0.5) * 1,
                        bot.entity.pitch + (Math.random() - 0.5) * 0.5);
                }
                if (config.afkSettings.randomActions) {
                    const rnd = Math.random();
                    if (rnd < 0.1) bot.setControlState('jump', true);
                    else bot.setControlState('jump', false);

                    if (rnd > 0.9) bot.setControlState('sneak', true);
                    else bot.setControlState('sneak', false);

                    if (rnd > 0.4 && rnd < 0.5) bot.swingArm('right');
                }
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
    log.warn('Остановка бота...');
    cleanup();
    if (bot) bot.quit();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    log.error(`Критическая ошибка: ${err}`);
    handleReconnect();
});

startBot();
