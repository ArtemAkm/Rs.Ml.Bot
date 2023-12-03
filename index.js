const { Telegraf, session, Markup, Extra } = require('telegraf');
const fs = require('fs');
const https = require('https');

const sqlite3 = require('sqlite3');
const config = require('./config');
const path = require('path');
const AdmZip = require('adm-zip');

const bot = new Telegraf(config.botToken);

const db = new sqlite3.Database('user.db');

const fetch = require('node-fetch');
const { promisify } = require('util');

const exchangesFolder = 'exchanges';
const solarSystemFolder = 'solar_system';
const worldFolder = 'world';
const checkWorldFolder = 'check_world';

const participantsFile = 'participants.json';
const bannedUsersFile = 'banusers.json';
const ownerId = config.adminID; 

const waitingForApproval = {}; 
const bannedUsers = {};

const maxUsers = config.maxusers;

const participants = loadParticipants();

let approvedUsersCount = participants.length;
let isRegistrationOpen = false;

let stazis = false;

if (approvedUsersCount < maxUsers) {
  isRegistrationOpen = true;
}

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, status TEXT)');
});

bot.use(session());


function isUserBanned(userId) {
  const bannedUsersList = loadBannedUsers(); // Загружаем список забаненных перед каждой проверкой
  return bannedUsersList.some(user => user.id === userId);
}

// Функция, выполняющаяся перед выполнением каждой команды
bot.use((ctx, next) => {
  const userId = String(ctx.from.id);

  // Проверяем, является ли пользователь администратором (ownerId)
  const isAdmin = String(userId) === String(ownerId);


  // Если пользователь не администратор и находится в списке забаненных, отказываем в выполнении команды
  if (!isAdmin && isUserBanned(userId)) {
      ctx.reply(`
Вы забанены и не можете использовать бота, если не согласны с решением администрации, обратитесь в техподдержку:

@Morty_Flame - Rocket Space`);
      return;
  }

  // Продолжаем выполнение следующей команды
  next();
});

bot.start((ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstname = ctx.from.first_name;

  // Вставляем пользователя в базу данных
  db.run('INSERT OR IGNORE INTO users (id, username, status) VALUES (?, ?, ?)', [userId, username, 'none'], (err) => {
    if (err) {
      console.error(err.message);
    }
  });


  const keyboard = Markup.keyboard([
    ['🚀 Заполнить анкету 🚀'],
    ['🤖 Все команды 🤖', 'ℹ️ Дополнительная информация ℹ️'],
    ['📔 Правила 📔']
  ]).resize();

  // Отправляем приветственное сообщение
  ctx.reply(`
Привет, ${firstname}! Я бот R. S. Multiplayer!

Благодаря мне ты сможешь учавствовать в мультиплеере!
Если у вас не открылась панель, нажмите на самую первую кнопку справа от поля ввода
  `, { ...keyboard, parse_mode: 'Markdown' }); 
});

const getUserNameById = (userId, callback) => {
  db.get('SELECT username FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) {
      console.error(err.message);
      callback(err, null);
    } else {
      const username = row ? row.username : null;
      callback(null, username);
    }
  });
};

const getUserStatusById = (userId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT status FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) {
        console.error(err.message);
        reject(err);
      } else {
        const status = row ? row.status : null;
        resolve(status);
      }
    });
  });
};

// Function to set user status by id
const setUserStatusById = (userId, status) => {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET status = ? WHERE id = ?', [status, userId], (err) => {
      if (err) {
        console.error(err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};


// Обработчик команды /system
bot.command('system', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const userStatus = await getUserStatusById(userId);

    if (userId === ownerId) { // Замени на актуальный статус
      if (userStatus === 'system') {
        ctx.reply('Файл для команды /system уже ожидается. Пожалуйста, дождитесь завершения предыдущей операции.');
        return;
      }

      // Устанавливаем статус 'system' в БД
      await setUserStatusById(userId, 'system');

      ctx.reply('Отправьте .zip файл игровой солнечной системы.');
    } else {
      ctx.reply('У вас нет доступа к этой команде');
    }
  } catch (error) {
    console.error('Произошла ошибка при получении/установке статуса пользователя:', error);
    ctx.reply('Произошла ошибка при обработке команды.');
  }
});

// Обработчик команды /world
bot.command('world', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const userStatus = await getUserStatusById(userId);

    if (userId === ownerId) { // Замени на актуальный статус
      if (userStatus === 'world') {
        ctx.reply('Файл для команды /world уже ожидается. Пожалуйста, дождитесь завершения предыдущей операции.');
        return;
      }

      // Устанавливаем статус 'world' в БД
      await setUserStatusById(userId, 'world');

      ctx.reply('Отправьте .zip файл игрового мира.');
    } else {
      ctx.reply('У вас нет доступа к этой команде');
    }
  } catch (error) {
    console.error('Произошла ошибка при получении/установке статуса пользователя:', error);
    ctx.reply('Произошла ошибка при обработке команды.');
  }
});

// Обработчик документа для получения файлов
bot.on('document', async (ctx) => {
  const userId = ctx.from.id;

  const waitingForFileStatus = await getUserStatusById(userId);

  const fileId = ctx.message.document.file_id;
  const file = await ctx.telegram.getFile(fileId);
  const downloadLink = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
  
  // В зависимости от статуса ожидания вызываем соответствующую функцию обработки файла
  if (waitingForFileStatus === 'system') {
    handleSystemFile(ctx, downloadLink);
  } else if (waitingForFileStatus === 'world') {
    handleWorldFile(ctx, downloadLink);
  }
});

async function downloadFile(url, destination) {
  const response = await fetch(url);
  const buffer = await response.buffer();
  await promisify(fs.writeFile)(destination, buffer);
}

// Функция обработки файла для команды /system
function handleSystemFile(ctx, downloadLink) {
  const userId = ctx.from.id;
  const exchangesFolderPath = path.join(__dirname, exchangesFolder);
  const solarSystemFolderPath = path.join(exchangesFolderPath, solarSystemFolder);

  // Создаем папку exchanges, если её нет
  if (!fs.existsSync(exchangesFolderPath)) {
    fs.mkdirSync(exchangesFolderPath);
  }

  // Создаем папку solar_system, если её нет
  if (!fs.existsSync(solarSystemFolderPath)) {
    fs.mkdirSync(solarSystemFolderPath);
  }

  // Формируем путь для сохранения файла
  const fileName = `solar_system.zip`;
  const filePath = path.join(solarSystemFolderPath, fileName);

  // Скачиваем файл
  downloadFile(downloadLink, filePath)
    .then(() => {
      ctx.reply('Файл игровой солнечной системы успешно сохранен.');
      setUserStatusById(userId, null); // Сбрасываем статус ожидания файла
    })
    .catch((error) => {
      console.error('Ошибка при скачивании файла:', error);
      ctx.reply('Произошла ошибка при скачивании файла. Пожалуйста, попробуйте приписать команду еще раз.');
      setUserStatusById(userId, null); // Сбрасываем статус ожидания файла
    });
}

// Функция обработки файла для команды /world
async function handleWorldFile(ctx, downloadLink) {
  const userId = ctx.from.id;
  
  const exchangesFolderPath = path.join(__dirname, exchangesFolder);
  const worldFolderPath = path.join(exchangesFolderPath, worldFolder);
  const checkWorldFolderPath = path.join(exchangesFolderPath, checkWorldFolder);

  // Создаем папку exchanges, если её нет
  if (!fs.existsSync(exchangesFolderPath)) {
    fs.mkdirSync(exchangesFolderPath);
  }

  // Создаем папку world, если её нет
  if (!fs.existsSync(worldFolderPath)) {
    fs.mkdirSync(worldFolderPath);
  }

  // Создаем папку check_world, если её нет
  if (!fs.existsSync(checkWorldFolderPath)) {
    fs.mkdirSync(checkWorldFolderPath);
  }

  // Формируем путь для сохранения файла
  const fileName = `world.zip`;
  const filePath = path.join(worldFolderPath, fileName);

  // Скачиваем файл
  try {
    await downloadFile(downloadLink, filePath);

    // Проверяем наличие backup.txt внутри архива в папке Multiplayer\Backup
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    const backupTxtEntry = zipEntries.find((entry) => {
      const entryPath = entry.entryName.replace(/\\/g, '/'); // Заменяем обратные слеши на прямые
      return entryPath.startsWith('Multiplayer/Backup/') && entryPath.endsWith('/backup.txt');
    });

    if (!backupTxtEntry) {
      ctx.reply('Файл не соответствует нормам мультиплеера, отправьте нужный файл');
      clearDirectory(checkWorldFolderPath);
    } else {
      // Перемещаем архив в папку world
      fs.renameSync(filePath, path.join(worldFolderPath, fileName));
      ctx.reply('Файл игрового мира успешно сохранен.');
      await setUserStatusById(userId, null); // Сбрасываем статус ожидания файла
      // Очищаем содержимое папки check_world
      clearDirectory(checkWorldFolderPath);
    }
  } catch (error) {
    console.error('Ошибка при скачивании файла:', error);
    ctx.reply('Произошла ошибка при скачивании файла. Пожалуйста, попробуйте еще раз.');
    await setUserStatusById(userId, null); // Сбрасываем статус ожидания файла
    // Очищаем содержимое папки check_world
    clearDirectory(checkWorldFolderPath);
  }
}

// Функция для очистки содержимого папки
function clearDirectory(directoryPath) {
  const files = fs.readdirSync(directoryPath);

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    fs.unlinkSync(filePath);
  }
}


bot.command('begin', async (ctx) => {
  const userId = ctx.from.id;

  if (userId !== ownerId) {
    ctx.reply('У вас нет доступа к этой команде');
    return;
  }

  if (stazis) {
    ctx.reply('Файлообмен находится в режиме стазиса. Сбросте его');
    return;
  }

  const solarSystemFilePath = path.join(__dirname, exchangesFolder, solarSystemFolder, 'solar_system.zip');
  const worldFilePath = path.join(__dirname, exchangesFolder, worldFolder, 'world.zip');

  // Проверяем наличие файлов в папках solar_system и world
  if (!fs.existsSync(solarSystemFilePath) || !fs.existsSync(worldFilePath)) {
    ctx.reply('Ошибка: отсутствуют необходимые файлы для выполнения команды /begin.');
    return;
  }

  // Здесь добавим логику по работе с участниками
  const participants = loadParticipants();

  if (participants.length === 0) {
    ctx.reply('В файле participants.json нет записей. Добавьте участников перед началом файлообмена.');
    return;
  }

  // Поиск записи с played: now
  const activeParticipant = participants.find(participant => participant.played === 'now');

  if (activeParticipant) {
    // Устанавливаем статус 'player' в БД
    await setUserStatusById(activeParticipant.id, 'player');
    ctx.reply(`Продолжаем файлообмен для пользователя ${activeParticipant.username}. Ожидаем от него файл.`);
    return;
  } else {
    const nextParticipant = participants.filter(participant => participant.played === false)
    .reduce((min, participant) => (participant.queueNumber < min.queueNumber) ? participant : min, { queueNumber: Infinity });

  if (nextParticipant.queueNumber !== Infinity) {
    // Устанавливаем статус 'player' в БД
    await setUserStatusById(nextParticipant.id, 'player');

    // Отправляем сообщение с кнопками и файлами
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('🌍 World', 'world'),
      Markup.button.callback('🪐 Solar System', 'solar_system'),
    ]);

    await bot.telegram.sendMessage(nextParticipant.id, 'Вы выбраны для файлообмена. Выберите тип файла:', { reply_markup: keyboard });

    // Устанавливаем played: now
    nextParticipant.played = 'now';
    saveParticipants(participants);

    // Запускаем таймер на 12 часов
    const endTime = new Date();
    endTime.setHours(endTime.getHours() + 12);

    timer = setInterval(() => {
      const remainingTime = Math.ceil((endTime - new Date()) / (60 * 1000)); // Время в минутах

      if (remainingTime > 0) {
        if ([360, 300, 240, 180, 120, 60, 30, 10].includes(remainingTime)) {
          bot.telegram.sendMessage(nextParticipant.id, `До окончания файлообмена осталось ${remainingTime} минут.`);
        }
      } else {
        // Таймер истек, завершаем файлообмен
        clearInterval(timer);
        completeFileExchange(nextParticipant);
      }
    }, 60000); // Проверка каждую минуту
  } else {
    ctx.reply('Нет доступных участников. Добавьте участников перед началом файлообмена.');
    stazis = true; // Переводим бота в режим стазиса
  }
}
  });

bot.command('ban', (ctx) => {
  if (ctx.from.id !== ownerId) {
    ctx.reply('У вас нет доступа к этой команде');
    return;
  }

  // Разбираем текст команды, чтобы получить ID пользователя и причину бана
  const match = ctx.message.text.match(/(\d{9,})\s+(.*)/);

  if (!match) {
    ctx.reply('Пожалуйста, укажите идентификатор пользователя (ID) и причину бана.');
    return;
  }

  const userIdToBan = match[1];
  const banReason = match[2];

  getUserNameById(userIdToBan, (err, username) => {
    const usernameToBan = username;
    const bannedUsersList = loadBannedUsers();

    // Проверяем, забанен ли уже пользователь
    const isUserBanned = bannedUsersList.some((user) => user.id === userIdToBan);

    if (isUserBanned) {
      ctx.reply('Этот пользователь уже забанен.');
      return;
    }

    bannedUsersList.push({
      id: userIdToBan,
      username: usernameToBan,
      reason: banReason, // Добавляем причину бана в объект пользователя
    });

    // Сохраняем обновленный список забаненных пользователей в файл
    saveBannedUsers(bannedUsersList);

    ctx.telegram.sendMessage(
      userIdToBan,`
Вы были забанены! 
Причина: <b>${banReason}</b>

Если у вас есть вопросы или вы хотите оспорить бан, обращайтесь в тех. поддержку:

@Morty_Flame - Rocket Space`,
      { parse_mode: 'HTML' }
    );

    ctx.telegram.sendMessage(
      ownerId,`
Пользователь @${usernameToBan} (ID: ${userIdToBan}) был забанен!
Причина: <b>${banReason}</b>`,
      { parse_mode: 'HTML' }
    );
  });
});


function loadBannedUsers() {
  try {
    const data = fs.readFileSync(bannedUsersFile, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveBannedUsers(bannedUsersList) {
  const data = JSON.stringify(bannedUsersList, null, 2);
  fs.writeFileSync(bannedUsersFile, data);
}

function loadBannedUsers() {
  try {
    const data = fs.readFileSync(bannedUsersFile, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveBannedUsers(bannedUsersList) {
  const data = JSON.stringify(bannedUsersList, null, 2);
  fs.writeFileSync(bannedUsersFile, data);
}

bot.command('unban', (ctx) => {

  if (ctx.from.id !== ownerId) {
      ctx.reply('У вас нет доступа к этой команде');
      return;
  }

  // Check if the user provided the user ID
  const userIdToUnban = ctx.message.text.match(/(\d+)/)?.[1];

  if (!userIdToUnban) {
      ctx.reply('Пожалуйста, укажите идентификатор пользователя (ID) для разбана.');
      return;
  }
  getUserNameById(userIdToUnban, (err, username) => {
    const bannedUsersList = loadBannedUsers();

    const indexOfBannedUser = bannedUsersList.findIndex(user => user.id === userIdToUnban);

    if (indexOfBannedUser === -1) {
        ctx.reply('Этот пользователь не забанен.');
        return;
    }

    // Remove the user from the banned list
    bannedUsersList.splice(indexOfBannedUser, 1);

    // Save the updated list of banned users to the file
    saveBannedUsers(bannedUsersList);

    ctx.telegram.sendMessage(userIdToUnban, 'С вас был снят бан. Теперь вы можете продолжить использование бота.');

    ctx.telegram.sendMessage(ownerId, `Пользователь @${username} (ID: ${userIdToUnban}) был разбанен.`);
    });

});

bot.command('banlist', (ctx) => {
  const userheg = ctx.from.username;
  const userId = ctx.from.id;

  if (userId !== ownerId) {
    ctx.reply('У вас нет доступа к этой команде');
    return;
  }

  const bannedUsersList = loadBannedUsers();

  if (bannedUsersList.length === 0) {
    ctx.reply('Список забаненных пользователей пока пуст.');
    return;
  }

  let listText = 'Список забаненных пользователей:\n';

  bannedUsersList.forEach((bannedUser, index) => {
    const username = bannedUser.username;
    const userId = bannedUser.id;
    const banReason = bannedUser.reason || 'Причина не указана'; // Добавим проверку на наличие причины бана

    listText += `${index + 1}. @${username}, ID: ${userId}, Причина: :"<b>${banReason}</b>"\n`;
  });

  ctx.replyWithHTML(listText);
});


bot.command('plist', (ctx) => {
  const userheg = ctx.from.username;
  if (ctx.from.id !== ownerId) {
    ctx.reply('У вас нет прав на эту команду!');
    return;
  }

  const participants = loadParticipants();

  if (participants.length === 0) {
    ctx.reply('Список участников пока пуст.');
    return;
  }

  let listText = 'Список участников:\n';

  participants.forEach((participant, index) => {
    const username = participant.username;
    const userId = participant.id;
    listText += `${index + 1}. @${username}, ID: ${userId}\n`;
  });

  ctx.replyWithHTML(listText);
});

bot.hears('ℹ️ Дополнительная информация ℹ️', (ctx) => {

  ctx.reply(`
С моей помощью вы можете подать анкету и встать в очередь на мультиплеер.
  
Мультиплеер в SpaceFlight Simulator Устроен следующим образом:
Вы заполняете анкету и автоматические занимаете очередь и когда она доходит до вас, вы автоматически получаете мир, вам даётся 12 часов для игры в данном мире. Вы должны отправить мир обратно до истечения этого времени. Бот будет об этом напоминать.
После идёт проверка мира, и отправка следующему человеку по очереди. Бот так же оповестит, когда наступит ваша очередь.
Если пришла ваша очередь брать мир, но у вас нету времени на тот момент, у вас есть возможность пропустить свою очередь. И вы отправляетесь в ожидание. Бот вас оповестит когда будет возможность принять мир снова.
Примечание: в каждом сезоне только ${maxUsers} участников. Если это число достигнуто, больше пользователи приниматься не будут. Ожидайте следую
    
При возникновении каких-либо вопросов обращайтесь к нам:
    
@akmdnepr - Кодер Артем
@ArKa2561 - Тех. поддержка (лучше обращайтесь сюда)
@Morty_Flame - Rocket Space`);
});


bot.hears('🤖 Все команды 🤖', (ctx) => {
  ctx.reply(`
Доступные команды:
  
/an - заполнить анкету
/rules - правила 
  `);
});


bot.hears('📔 Правила 📔', (ctx) => {

  ctx.reply(`
Правила мультиплеера:

1. У вас есть 12 часов для игры в мире и его отправки.
2. Нельзя ломать, удалять, изменять и как-либо портить чужие постройки. Можно их дополнять.
3. Должны быть адекватные названия построек.
    
При нарушении какого-либо из правил человек отправляется в черный список. Это значит, что человек не сможет учавствовать в мультиплеере никогда.
  `);
});

bot.command('open', (ctx) => {
  
  if (ctx.from.id !== ownerId) {
    ctx.reply('У вас нет доступа к этой команде');
    return;
  }

  isRegistrationOpen = true;
  ctx.reply('Регистрация открыта. Новые анкеты принимаются.');
});

bot.command('close', (ctx) => {

  if (ctx.from.id !== ownerId) {
    ctx.reply('У вас нет доступа к этой команде');
    return;
  }

  isRegistrationOpen = false;
  ctx.reply('Регистрация закрыта. Новые анкеты не принимаются.');
});

function isUserInList(userId) {
  const participants = loadParticipants();
  return participants.some((participant) => participant.id === userId) && !bannedUsers[userId];
}

bot.hears('🚀 Заполнить анкету 🚀', (ctx) => {
  const userheg = ctx.from.username;
  const userId = ctx.from.id;

  if (hasExceededTries(userId)) {
    ctx.reply('Вы уже отправили анкету! Больше попыток нет');
    return;
  }

  if (isUserInList(userId)) {
    ctx.reply('Вы уже находитесь в списке одобренных пользователей.');
    return;
  }

  if (approvedUsersCount >= maxUsers) {
    ctx.reply('Достигнуто максимальное количество одобренных пользователей. Регистрация закрыта.');
    isRegistrationOpen = false; 
    return;
  }


  if (!isRegistrationOpen) {
    ctx.reply(`
Регистрация закрыта. Попробуйте позже. Всю актуальную информацию про мультиплеер ищите на официальном канале: 

https://t.me/rocketSpaceee`);
    return;
  }


  ctx.reply(`
Заполните анкету следуя примеру.

ВНИМАНИЕ!!! У вас есть всего 1 попытка на заполнение акеты! Отнеситесь к этому серьезно!

Имя: Доминик
Наигранное время: 5 месяцев
Что планирую в мире: Мегастанцию на орбите Юпитера
Сколько часов могу играть: 4
Как я оцениваю свои навыки: 7 (из 10)
  `);

  setTimeout(() => ctx.reply('Введите ваше имя:'), 2000);
  waitingForApproval[userId] = { step: 1, data: {} };
});

bot.on('text', (ctx) => {
  const userheg = ctx.from.username;
  const userId = ctx.from.id;

  if (waitingForApproval[userId]) {
    const { step, data } = waitingForApproval[userId];

    if (step === 1) {
      data.name = ctx.message.text;
      ctx.reply('Введите наигранное время:');
      waitingForApproval[userId] = { step: 2, data };
    } else if (step === 2) {
      data.playedTime = ctx.message.text;
      ctx.reply('Введите, что планируете в мире:');
      waitingForApproval[userId] = { step: 3, data };
    } else if (step === 3) {
      data.plan = ctx.message.text;
      ctx.reply('Введите, сколько часов можете играть:');
      waitingForApproval[userId] = { step: 4, data };
    } else if (step === 4) {
      data.hoursPerDay = ctx.message.text;
      ctx.reply('Как вы оцениваете свои навыки (от 1 до 10). Пожалуйста, введите число:');
      waitingForApproval[userId] = { step: 5, data };
    } else if (step === 5) {
      if (!isNaN(ctx.message.text)) {
        const skillLevel = parseInt(ctx.message.text);

        if (skillLevel >= 1 && skillLevel <= 10) {
          data.skills = skillLevel.toString();

          if (validateAnketa(data)) {
            ctx.reply('Вы отправили анкету! Пожалуйста, подождите пока администрация ее проверит.');

            userTries[userId]++;

            ctx.telegram.sendMessage(ownerId, `Пользователь @${userheg} отправил анкету. Его ID: ${userId}\n\nИмя: ${data.name}\nНаигранное время: ${data.playedTime}\nПлан в мире: ${data.plan}\nЧасов игры в день: ${data.hoursPerDay}\nОценка навыков: ${data.skills}`, {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: 'Одобрить', callback_data: `approve:${userId}` },
                    { text: 'Отклонить', callback_data: `reject:${userId}` },
                    { text: 'Забанить', callback_data: `ban:${userId}`}
                  ]
                ]
              }
            });
          } else {
            ctx.reply(`
Произошла ошибка при отправке анкеты. Попробуйте заполнить анкету повторно, если не поможет и бот не укажет никаких причин при попытке повторного заполнения -  обращайтесь в тех поддержку:

@akmdnepr - Кодер Артем
@ArKa2561 - Тех. поддержка (лучше обращайтесь сюда)
@Morty_Flame - Rocket Space
          `);
          }

          delete waitingForApproval[userId];
        } else {
          ctx.reply('Пожалуйста, введите корректную оценку навыков от 1 до 10.');
        }
      } else {
        ctx.reply('Пожалуйста, введите числовую оценку навыков.');
      }
    }
  }
});

bot.action(/ban:(\d+)/, async (ctx) =>{
  const userId = ctx.match[1];
  const autoReplyText = `/ban ${userId} долбоеб`;
  ctx.replyWithHTML(`Команда для бана: <code>${autoReplyText}</code>`);
})

bot.action(/approve:(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  const userAnketa = waitingForApproval[userId];

  // Пользуемся функцией getUserNameById для получения username по userId
  getUserNameById(userId, (err, username) => {
    if (err) {
      console.error('Ошибка при получении username:', err);
    } else {
      if (username) {
        // Используем полученное имя пользователя в сообщении
        ctx.reply(`Вы успешно одобрили анкету пользователя @${username} (ID: ${userId})!`);
        delete waitingForApproval[userId];

        if (!isUserInList(userId)) {
          addApprovedUserToParticipants(userId, username);
          approvedUsersCount++;
          ctx.telegram.sendMessage(userId, 'Ваша анкета одобрена. Вы добавлены в очередь. Поздравляем!');
        } else {
          ctx.telegram.sendMessage(ownerId, `Попытка повторного одобрения анкеты пользователя @${username} (ID: ${userId}). Этот пользователь уже есть в списке.`);
        }
      } else {
        ctx.reply(`Не удалось найти пользователя с ID: ${userId}`);
      }
    }
  });
});

bot.action(/reject:(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  ctx.reply('Вы отклонили анкету пользователя!');
  ctx.telegram.sendMessage(userId, 'Ваша анкета отклонена');

  delete waitingForApproval[userId];

});

function validateAnketa(userId) {

  if (hasExceededTries(userId)) {
    return;
  }

  if (isUserInList(userId)) {
    return;
  }

  if (approvedUsersCount >= maxUsers) {
    isRegistrationOpen = false; 
    return;
  }


  if (!isRegistrationOpen) {
    return;
  }

  return true; 
}

function addApprovedUserToParticipants(userId, username, played = false) {
  const participants = loadParticipants();

  if (participants.length < maxUsers) {
    const numericUserId = parseInt(userId);
    const newUser = {
      id: numericUserId,
      queueNumber: participants.length + 1,
      username: username,
      played: false
    };
    participants.push(newUser);
    saveParticipants(participants);
  }
  else{
    ctx.reply('Не удалось добавить пользователя, максимальное количество участников уже было достигнуто!')
  }
}



function loadParticipants() {
  try {
    const data = fs.readFileSync(participantsFile, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveParticipants(participants) {
  const data = JSON.stringify(participants, null, 2);
  fs.writeFileSync(participantsFile, data);
}

function isQueueFull() {
  const participants = loadParticipants();
  return participants.length >= maxUsers;
}

const userTries = {};


function hasExceededTries(userId) {
  if (!userTries[userId]) {
    userTries[userId] = 1;
  }
  const exceeded = userTries[userId] > 1;


  return exceeded;
}


bot.launch();