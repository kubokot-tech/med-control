# Security / Безопасность

## Reporting a vulnerability

Please do not open a public issue for a security problem. Write to **support@med-control.app** or use GitHub's
"Report a vulnerability" button on the Security tab of this repository.

Include what you found, how to reproduce it and which version or commit you tested. Do not include real medical
data; an invented example is enough.

MedControl is maintained by one person in their free time, so there is no guaranteed response time. Reports are
read, confirmed issues are fixed in the next release and credited in the changelog unless you ask otherwise.

Only the latest release is supported.

## Сообщить об уязвимости

Не открывайте публичный issue о проблеме безопасности. Напишите на **support@med-control.app** или нажмите
«Report a vulnerability» на вкладке Security этого репозитория.

Опишите, что нашли, как это воспроизвести и на какой версии или коммите проверяли. Настоящих медицинских данных
не присылайте: достаточно вымышленного примера.

Проект ведёт один человек в свободное время, поэтому срок ответа не гарантируется. Сообщения читаются,
подтверждённые проблемы исправляются в следующем выпуске, автор сообщения упоминается в истории версий, если не
попросит об обратном.

Поддерживается только последняя версия.

## What to keep in mind when you run MedControl / Что учесть при установке

- The published port is bound to this computer by default. If you expose it to the internet, put HTTPS in front
  (Tailscale, Cloudflare Tunnel or your own reverse proxy) and choose a long password: sign-in is by password only.
  Порт по умолчанию открыт только на этом компьютере. Если открываете его в интернет, поставьте перед ним HTTPS
  и задайте длинный пароль: вход только по паролю.
- Backups contain the whole medical history. Keep them where only you can read them; cloud copies should be
  encrypted (see docs/OPERATIONS.md).
  Резервные копии содержат всю историю лечения. Храните их там, где их читаете только вы; копии в облаке должны
  быть зашифрованы (docs/OPERATIONS.md).
