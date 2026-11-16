/** Password hashing (scrypt) and strength rules. Pure: no database, usable in unit tests. */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 10;

// The rule of earlier versions: eight characters and not one of these. Kept only to judge DTC_PASSWORD of an existing install.
const LEGACY_WEAK = new Set(['', 'password', 'change_me', 'changeme', '123456', '12345678', 'qwerty', 'dtc', 'medcontrol', 'медконтроль']);

// digits, spaces and punctuation at either end of a password: «123password!» → «password»
const EDGES = /^[\d\s\p{P}\p{S}]+|[\d\s\p{P}\p{S}]+$/gu;

/**
 * Common passwords and the words they are built from, lower case, without the digits and punctuation people add at
 * the ends («Password2024!» is looked up as «password»). The password is the only thing between the internet and a
 * medical history when no passkey is added, so the list is about what a guessing script tries first: the top of leaked
 * lists, names, Russian words in Latin letters and typed on the wrong keyboard layout, keyboard walks, our own name.
 */
const COMMON = new Set(`
password passw0rd p@ssword p@ssw0rd pa55word pa$$word passwd pass passwort parole mypassword newpassword password1q
mypass passcode passphrase secret topsecret secretpassword letmein letmeinnow welcome welcomehome welcomeback
login logon signin access accessgranted admin administrator adminadmin root rootroot toor superuser sysadmin
user username guest default temp temporary test tester testing testtest testpassword demo demodemo example sample
changeme change_me changeit changepassword fixme iloveyou iloveu loveyou loveme lovely love lover forever
qwerty qwertyuiop qwertyui qwert qwerty1q qwe qweasd qweasdzxc qwer qwerasdf qwerasdfzxcv asdf asdfgh asdfghjkl
asdfasdf zxcvbn zxcvbnm zxcv zaq1xsw2 zaq12wsx xsw2zaq1 q1w2e3 q1w2e3r4 q1w2e3r4t5 1q2w3e 1q2w3e4r 1q2w3e4r5t 1qaz2wsx
1qazxsw2 qazwsx qazwsxedc qazxsw qazqaz wsxedc azerty azertyuiop qwertz qwertzuiop poiuytrewq mnbvcxz lkjhgfdsa
abc abcd abcde abcdef abcdefg abcdefgh abc123abc abcabc aaa aaaa abcxyz xyz a1b2c3 a1b2c3d4 a1s2d3f4 z1x2c3v4
monkey dragon master shadow sunshine princess football baseball basketball soccer hockey superman batman spiderman
michael jennifer jordan michelle daniel jessica charlie thomas andrew joshua matthew anthony robert william
ashley amanda nicole hannah summer winter spring autumn monday friday sunday january december flower flowers
killer hunter ranger harley buster soldier tigger pepper ginger cookie chocolate banana orange cheese coffee
computer internet samsung google android iphone apple microsoft windows linux ubuntu server database mysql
postgres postgresql docker oracle cisco network router wifi wireless homeserver nas synology raspberry
trustno1 trustnoone whatever freedom starwars pokemon minecraft matrix mustang ferrari mercedes porsche
hello helloworld hithere goodbye thankyou please blessed jesus heaven angel angels pretty
money dollar bitcoin crypto lucky number numberone qazwsxedcrfv nothing
medcontrol med-control med_control medkontrol medcontrolapp medcontrol-app dtc dtcdtc dtcadmin health myhealth
healthcare medical medicine medic doctor doctors hospital clinic patient pacient nurse pharmacy therapy
oncology cancer fuckcancer diagnosis analysis analiz analizy labs laboratory zdorovie zdorove zdorovje
bolnica bolnitsa doktor vrach lekarstvo lechenie medicina poliklinika medkarta history medhistory
parol moyparol moiparol privet privetik poka zdravstvuy zdravstvuyte spasibo pozhaluysta
lyubov lubov ljubov lyublyu yalyublyu yalublu yatebyalyublyu lubimaya lyubimaya lyubimyy solnyshko solnce
zayka zaika kotik kotenok kiska koshka sobaka mama papa mamapapa mamochka babushka dedushka semya semja
sasha sashka masha natasha nastya nastena dasha katya ekaterina olga olya tanya tatyana irina yulia yuliya julia
elena lena anna anya maria mariya marina svetlana sveta oksana kristina alina polina vika viktoria victoria
sergey sergei andrey andrei alexey aleksey alex alexander aleksandr dmitry dmitriy dima maxim maksim max ivan
vladimir vova nikita nikolay kolya mikhail misha pavel pasha roman artem artyom denis evgeny zhenya oleg igor
moskva moscow rossiya russia piter peterburg spartak zenit dinamo lokomotiv cska rodina pobeda mir
vodka medved matreshka nokia telefon komputer kompyuter rabota dengi schastye schastie zvezda
gfhjkm ghbdtn yfnfif vfhbyf fylhtq cthutq dkflbvbh k.,jdm rjirf vfvf gfgf ntcn flvby flvbybcnhfnjh ljrnjh pljhjdmt
йцукен йцукенг йцуке фыва фывапр ячсмит ячсмить пароль парол мойпароль привет любовь люблю ялюблю солнышко
наташа настя маша саша даша катя ольга татьяна ирина юлия елена анна мария марина сергей андрей алексей
александр дмитрий максим иван владимир никита николай михаил павел роман мама папа семья кошка собака
медконтроль мед-контроль здоровье больница доктор врач лекарство лечение пациент анализы админ администратор
тест тесттест секрет вход логин гость москва россия спартак зенит победа родина счастье деньги работа
`.split(/\s+/).flatMap((w) => [w, w.replace(EDGES, '')]).filter(Boolean));

// Rows of the keyboard and alphabets: a password made only of pieces of these («qwertyuiop12», «asdfgh-123456») is a walk
const RUNS = [
  'abcdefghijklmnopqrstuvwxyz', '01234567890', '1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  'qazwsxedcrfvtgbyhnujmikolp', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p', '1q2w3e4r5t6y7u8i9o0p',
  'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'абвгдежзийклмнопрстуфхцчшщъыьэюя', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю',
];
const RUNS_BOTH_WAYS = [...RUNS, ...RUNS.map((r) => [...r].reverse().join(''))];
const MIN_RUN = 3;

/** Is the whole string made of pieces (three characters or more) of keyboard rows and alphabets, forward or backward? */
function onlyRuns(s) {
  if (s.length < MIN_RUN) return false;
  let i = 0;
  while (i < s.length) {
    let best = 0;
    for (const run of RUNS_BOTH_WAYS) {
      for (let at = run.indexOf(s[i]); at !== -1; at = run.indexOf(s[i], at + 1)) {
        let n = 0;
        while (i + n < s.length && at + n < run.length && s[i + n] === run[at + n]) n += 1;
        if (n > best) best = n;
      }
    }
    if (best < MIN_RUN) return false;
    i += best;
  }
  return true;
}

/** Is the password a common one once the case and what people add around a word are taken away? */
function commonBase(lower) {
  const base = lower.replace(EDGES, '');
  const joined = base.replace(/[\s._-]+/g, '');
  const half = joined.slice(0, joined.length / 2);
  return [lower, base, joined].some((x) => COMMON.has(x)) || (joined.length > 1 && half + half === joined && COMMON.has(half));
}

/**
 * A new password (first run, change, recovery): a problem code ('short' | 'weak') or null when it is acceptable.
 * At least ten characters; not digits only; not a handful of repeated characters; not a keyboard or alphabet walk;
 * not a common password with digits or punctuation around it. Stored passwords are not judged: they keep working.
 */
export function passwordProblem(p) {
  const s = String(p || '');
  if ([...s].length < MIN_PASSWORD_LENGTH) return 'short';
  const lower = s.toLowerCase();
  const solid = lower.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (/^\d*$/.test(solid)) return 'weak';
  if (new Set(solid).size < 4) return 'weak';
  if (onlyRuns(solid)) return 'weak';
  if (commonBase(lower)) return 'weak';
  return null;
}

/** The rule of earlier versions, for DTC_PASSWORD only: what started an install before must still start it. */
export function legacyPasswordProblem(p) {
  const s = String(p || '');
  if (s.length < 8) return 'short';
  if (LEGACY_WEAK.has(s.toLowerCase())) return 'weak';
  return null;
}

/**
 * DTC_PASSWORD from .env → { fatal, warning }. It is judged by the rule it was accepted under, so an existing install
 * keeps starting (`fatal` is what stopped it before too); a password the present rule would refuse for a new one only
 * gets `warning` for the log.
 */
export function envPasswordState(p) {
  if (!p) return { fatal: '', warning: '' };
  if (legacyPasswordProblem(p)) return { fatal: 'DTC_PASSWORD in .env must be at least 8 characters and not a common word', warning: '' };
  if (!passwordProblem(p)) return { fatal: '', warning: '' };
  return { fatal: '', warning: `DTC_PASSWORD in .env is weak: shorter than ${MIN_PASSWORD_LENGTH} characters, or a common password, a keyboard run or digits only. It still works, but it is all that keeps the medical records from being guessed: set a longer one in .env and restart the gateway.` };
}

export function hashPassword(p) {
  const salt = randomBytes(16);
  const key = scryptSync(String(p), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(p, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const key = scryptSync(String(p), salt, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
