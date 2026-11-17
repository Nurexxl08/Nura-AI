# Nura AI

AI-приложение: чат с Gemini, генерация изображений, Google-вход, задачи и заметки.

## Запуск

1. Установите Node.js 20.19 или новее.
2. Установите зависимости командой `npm install`.
3. Скопируйте `.env.example` в `.env` (PowerShell: `Copy-Item .env.example .env`).
4. Создайте Gemini API key в [Google AI Studio](https://aistudio.google.com/apikey) и добавьте его в `.env`:

   ```env
   GEMINI_API_KEY=ваш_ключ
   ```

5. Создайте OAuth Client ID типа **Web application** в Google Cloud Console. Для локального запуска добавьте `http://127.0.0.1:5173` в разрешённые источники JavaScript и укажите ID в `.env`:

   ```env
   GOOGLE_CLIENT_ID=ваш_client_id
   ```

6. Добавьте в `.env` случайный `SESSION_SECRET` длиной не менее 32 символов.
7. Запустите `npm run dev` и откройте адрес Vite, который появится в терминале.

Ключ Gemini и секрет сессии используются только сервером и не отправляются в браузер. Не публикуйте `.env` и не добавляйте его в Git. Запросы к Gemini могут расходовать квоту и тарифицироваться Google.

Если Gemini сообщает, что квота исчерпана, проверьте лимиты и оплату проекта в Google AI Studio. Вход в приложение через Google не изменяет квоту Gemini API.

## Возможности

- Диалоги с Gemini с сохранением контекста между сообщениями, поиском в интернете и запуском кода в изолированной среде.
- Создание и скачивание изображений через модель Gemini для изображений.
- История чатов, задачи и заметки, хранящиеся локально в браузере.
- Адаптивный интерфейс для компьютера и телефона.

## Публикация в Google Cloud Run

Для production уже настроены Dockerfile, раздача собранного frontend через Express и прослушивание Cloud Run-порта на внешнем интерфейсе. Требуются Google Cloud project с включённым billing, `gcloud` CLI и домен под вашим управлением.

1. В Google Cloud включите Cloud Run, Cloud Build и Secret Manager.
2. Сохраните `GEMINI_API_KEY` и случайный `SESSION_SECRET` (не менее 32 символов) в Secret Manager; выдайте service account Cloud Run доступ `Secret Manager Secret Accessor` к этим секретам.
3. Из корня проекта выполните, подставив регион и свой OAuth Client ID:

   ```sh
   gcloud run deploy nura-ai \
     --source . \
     --region asia-southeast1 \
     --allow-unauthenticated \
     --set-env-vars GOOGLE_CLIENT_ID=your_google_oauth_client_id \
     --set-secrets GEMINI_API_KEY=gemini-api-key:latest,SESSION_SECRET=nura-session-secret:latest
   ```

4. Добавьте выданный Cloud Run HTTPS URL в **Authorized JavaScript origins** OAuth Client ID. Для собственного домена подтвердите владение доменом, настройте DNS и добавьте `https://nuraai.com` в те же разрешённые источники.
5. Включите billing/квоту Gemini API отдельно от billing Cloud Run. Без активной квоты чат и генерация изображений будут возвращать ошибку 429.

Секреты не передавайте в командной строке, Git или чат. `gcloud run deploy` собирает Dockerfile и публикует контейнер; локальный `.env` в образ не копируется.

Если выбранные модели недоступны для вашего ключа, поменяйте `GEMINI_MODEL` или `GEMINI_IMAGE_MODEL` в настройках сервиса на модели, доступные в Google AI Studio.
