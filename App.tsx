import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUp,
  Check,
  CheckCheck,
  CircleHelp,
  Clock3,
  FileText,
  Image as ImageIcon,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import './App.css'

type View = 'chat' | 'images' | 'tasks'
type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  loading?: boolean
}
type Conversation = {
  id: string
  title: string
  updatedAt: number
  interactionId?: string
  messages: Message[]
}
type Task = {
  id: string
  title: string
  done: boolean
}
type Note = {
  id: string
  text: string
}
type Health = {
  configured: boolean
  textModel: string
  imageModel: string
  googleClientId: string
}
type GoogleUser = {
  email: string
  name: string
  picture: string
}
type GoogleCredentialResponse = {
  credential: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: GoogleCredentialResponse) => void
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              theme: 'filled_black'
              size: 'large'
              shape: 'pill'
              width: number
            },
          ) => void
        }
      }
    }
  }
}

const STORAGE_KEYS = {
  conversations: 'nura-conversations',
  activeConversation: 'nura-active-conversation',
  tasks: 'nura-tasks',
  notes: 'nura-notes',
}

const starterPrompts = [
  { icon: WandSparkles, title: 'Придумай идеи', prompt: 'Предложи 5 свежих идей для моего следующего проекта.' },
  { icon: FileText, title: 'Помоги разобраться', prompt: 'Объясни простыми словами, как работает искусственный интеллект.' },
  { icon: ListTodo, title: 'Составь план', prompt: 'Составь понятный план на эту неделю для изучения frontend-разработки.' },
]

const imagePrompts = [
  'Минималистичная иллюстрация рабочего места разработчика в тёплом утреннем свете',
  'Фантастический город будущего в синей и фиолетовой неоновой палитре',
  'Абстрактный градиентный постер с мягкими стеклянными формами',
]

let googleInitializedClientId = ''

function displayMessageText(message: string) {
  if (/^\s*429\b|You exceeded your current quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return 'Исчерпана квота Gemini API. Проверьте лимиты и оплату проекта в Google AI Studio. Вход через Google не увеличивает квоту.'
  }
  return message
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch (error) {
    console.error(`Не удалось прочитать локальные данные (${key}).`, error)
    return fallback
  }
}

function makeId() {
  return crypto.randomUUID()
}

async function requestJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const result = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(result.error || `Ошибка запроса (${response.status}).`)
  }

  return result
}

function App() {
  const [view, setView] = useState<View>('chat')
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    readStorage(STORAGE_KEYS.conversations, []),
  )
  const [activeConversationId, setActiveConversationId] = useState(() =>
    readStorage<string>(STORAGE_KEYS.activeConversation, ''),
  )
  const [tasks, setTasks] = useState<Task[]>(() => readStorage(STORAGE_KEYS.tasks, []))
  const [notes, setNotes] = useState<Note[]>(() => readStorage(STORAGE_KEYS.notes, []))
  const [health, setHealth] = useState<Health | null>(null)
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [googleScriptReady, setGoogleScriptReady] = useState(false)
  const [googleAuthError, setGoogleAuthError] = useState('')
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false)
  const [panelTab, setPanelTab] = useState<'tasks' | 'notes'>('tasks')
  const [panelOpen, setPanelOpen] = useState(false)
  const [messageDraft, setMessageDraft] = useState('')
  const [taskDraft, setTaskDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageError, setImageError] = useState('')
  const [sending, setSending] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [apiError, setApiError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const googleButtonRef = useRef<HTMLDivElement>(null)

  const signInWithGoogle = useCallback(async (credential: string) => {
    setGoogleAuthLoading(true)
    setGoogleAuthError('')
    try {
      const result = await requestJson<{ user: GoogleUser }>('/api/auth/google', {
        credential,
      })
      setGoogleUser(result.user)
      setProfileOpen(false)
    } catch (error) {
      setGoogleAuthError(
        error instanceof Error ? error.message : 'Не удалось войти через Google.',
      )
    } finally {
      setGoogleAuthLoading(false)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activeConversation, JSON.stringify(activeConversationId))
  }, [activeConversationId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes))
  }, [notes])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        startConversation()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    let active = true
    requestJson<Health>('/api/health')
      .then((result) => {
        if (active) setHealth(result)
      })
      .catch((error: Error) => {
        if (active) setApiError(error.message)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    requestJson<{ user: GoogleUser | null }>('/api/auth/me')
      .then(({ user }) => {
        if (active) setGoogleUser(user)
      })
      .catch((error: Error) => {
        if (active) setGoogleAuthError(error.message)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!health?.googleClientId) return

    let active = true
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (active) setGoogleScriptReady(true)
    }
    script.onerror = () => {
      if (active) setGoogleAuthError('Не удалось загрузить окно входа Google.')
    }
    document.head.appendChild(script)
    return () => {
      active = false
      script.remove()
    }
  }, [health?.googleClientId])

  useEffect(() => {
    const googleClientId = health?.googleClientId
    if (
      !googleScriptReady ||
      !googleClientId ||
      !window.google ||
      googleInitializedClientId === googleClientId
    ) {
      return
    }

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => {
        void signInWithGoogle(response.credential)
      },
    })
    googleInitializedClientId = googleClientId
  }, [health?.googleClientId, googleScriptReady, signInWithGoogle])

  useEffect(() => {
    const button = googleButtonRef.current
    if (!profileOpen || !googleScriptReady || !button || !window.google) return

    button.replaceChildren()
    window.google.accounts.id.renderButton(button, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      width: 280,
    })
  }, [googleScriptReady, profileOpen])

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations],
  )
  const pendingTasks = tasks.filter((task) => !task.done).length

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeConversation?.messages, sending])

  function startConversation() {
    const conversation: Conversation = {
      id: makeId(),
      title: 'Новый диалог',
      updatedAt: Date.now(),
      messages: [],
    }
    setConversations((current) => [conversation, ...current])
    setActiveConversationId(conversation.id)
    setView('chat')
    setApiError('')
    setMessageDraft('')
    composerRef.current?.focus()
  }

  function updateConversation(id: string, update: (current: Conversation) => Conversation) {
    setConversations((current) =>
      current.map((conversation) => (conversation.id === id ? update(conversation) : conversation)),
    )
  }

  async function sendMessage(text = messageDraft) {
    const prompt = text.trim()
    if (!prompt || sending) return
    if (!googleUser) {
      setProfileOpen(true)
      setGoogleAuthError('Войдите через Google, чтобы начать диалог.')
      return
    }

    let conversation = activeConversation
    if (!conversation) {
      conversation = {
        id: makeId(),
        title: 'Новый диалог',
        updatedAt: Date.now(),
        messages: [],
      }
      setConversations((current) => [conversation!, ...current])
      setActiveConversationId(conversation.id)
    }

    const currentConversation = conversation
    const userMessage: Message = { id: makeId(), role: 'user', text: prompt }
    const replyId = makeId()
    const reply: Message = { id: replyId, role: 'assistant', text: '', loading: true }
    const title = currentConversation.messages.length
      ? currentConversation.title
      : prompt.length > 32
        ? `${prompt.slice(0, 32).trimEnd()}…`
        : prompt

    updateConversation(currentConversation.id, (current) => ({
      ...current,
      title,
      updatedAt: Date.now(),
      messages: [...current.messages, userMessage, reply],
    }))
    setMessageDraft('')
    setApiError('')
    setSending(true)

    try {
      const result = await requestJson<{ text: string; interactionId: string }>('/api/chat', {
        message: prompt,
        previousInteractionId: currentConversation.interactionId,
      })
      updateConversation(currentConversation.id, (current) => ({
        ...current,
        interactionId: result.interactionId,
        updatedAt: Date.now(),
        messages: current.messages.map((message) =>
          message.id === replyId ? { ...message, text: result.text, loading: false } : message,
        ),
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось получить ответ.'
      updateConversation(currentConversation.id, (current) => ({
        ...current,
        updatedAt: Date.now(),
        messages: current.messages.map((item) =>
          item.id === replyId ? { ...item, text: message, loading: false } : item,
        ),
      }))
    } finally {
      setSending(false)
      composerRef.current?.focus()
    }
  }

  async function generateImage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = imagePrompt.trim()
    if (!prompt || generatingImage) return
    if (!googleUser) {
      setProfileOpen(true)
      setGoogleAuthError('Войдите через Google, чтобы создавать изображения.')
      return
    }

    setImageError('')
    setImageUrl('')
    setGeneratingImage(true)
    try {
      const result = await requestJson<{ data: string; mimeType: string }>('/api/images', { prompt })
      setImageUrl(`data:${result.mimeType};base64,${result.data}`)
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Не удалось создать изображение.')
    } finally {
      setGeneratingImage(false)
    }
  }

  function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = taskDraft.trim()
    if (!title) return
    setTasks((current) => [{ id: makeId(), title, done: false }, ...current])
    setTaskDraft('')
  }

  function addNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = noteDraft.trim()
    if (!text) return
    setNotes((current) => [{ id: makeId(), text }, ...current])
    setNoteDraft('')
  }

  function deleteConversation(id: string) {
    const remaining = conversations.filter((conversation) => conversation.id !== id)
    setConversations(remaining)
    if (activeConversationId === id) {
      setActiveConversationId(remaining[0]?.id ?? '')
    }
  }

  async function signOutGoogle() {
    try {
      await requestJson<{ success: boolean }>('/api/auth/logout', {})
      setGoogleUser(null)
      setProfileOpen(false)
    } catch (error) {
      setGoogleAuthError(
        error instanceof Error ? error.message : 'Не удалось выйти из аккаунта.',
      )
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => setView('chat')} aria-label="На главную">
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span className="brand-name">nura<span>ai</span></span>
          <span className="brand-beta">BETA</span>
        </button>

        <button className="new-chat-button" type="button" onClick={startConversation}>
          <Plus size={17} />
          <span>Новый диалог</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="sidebar-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="primary-nav" aria-label="Разделы">
          <button className={view === 'chat' ? 'nav-item active' : 'nav-item'} onClick={() => setView('chat')} type="button">
            <MessageSquareText size={17} /><span>Ассистент</span>
          </button>
          <button className={view === 'images' ? 'nav-item active' : 'nav-item'} onClick={() => setView('images')} type="button">
            <ImageIcon size={17} /><span>Изображения</span><span className="nav-new">AI</span>
          </button>
          <button className={view === 'tasks' ? 'nav-item active' : 'nav-item'} onClick={() => setView('tasks')} type="button">
            <ListTodo size={17} /><span>Мои задачи</span>
            {pendingTasks > 0 && <span className="nav-count">{pendingTasks}</span>}
          </button>
        </nav>

        <div className="sidebar-label history-label">ИСТОРИЯ</div>
        <div className="conversation-list">
          {conversations.length === 0 && <p className="empty-history">Здесь появятся ваши диалоги</p>}
          {conversations.map((conversation) => (
            <div className="conversation-row" key={conversation.id}>
              <button
                type="button"
                className={conversation.id === activeConversationId && view === 'chat' ? 'conversation active' : 'conversation'}
                onClick={() => {
                  setActiveConversationId(conversation.id)
                  setView('chat')
                }}
                title={conversation.title}
              >
                <MessageSquareText size={15} />
                <span>{conversation.title}</span>
              </button>
              <button
                type="button"
                className="icon-button conversation-delete"
                onClick={() => deleteConversation(conversation.id)}
                aria-label={`Удалить диалог ${conversation.title}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className={health?.configured ? 'connection-card connected' : 'connection-card'}>
            <span className="connection-dot" />
            <div>
              <strong>{health?.configured ? 'API-ключ настроен' : 'Нужен API-ключ'}</strong>
              <span>{health?.configured ? health.textModel : 'Настройте подключение'}</span>
            </div>
            <Settings2 size={16} />
          </div>
          <button
            className="profile-button"
            type="button"
            onClick={() => { setProfileOpen(true); setGoogleAuthError('') }}
          >
            {googleUser?.picture ? (
              <img className="profile-avatar-image" src={googleUser.picture} alt="" />
            ) : (
              <span className="profile-avatar">{googleUser?.name.slice(0, 1).toUpperCase() ?? 'N'}</span>
            )}
            <span className="profile-copy"><strong>{googleUser?.name ?? 'Ваше пространство'}</strong><small>{googleUser?.email ?? 'Войти через Google'}</small></span>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-muted">Пространство</span><span className="breadcrumb-divider">/</span>
            <strong>{view === 'chat' ? 'Ассистент' : view === 'images' ? 'Изображения' : 'Мои задачи'}</strong>
          </div>
          <div className="topbar-actions">
            <div className={health?.configured ? 'model-pill online' : 'model-pill'}>
              <span className="model-indicator" />
              <span>{health?.configured ? 'API-ключ настроен' : 'Gemini не настроен'}</span>
            </div>
            <a className="topbar-icon" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" title="Получить Gemini API key">
              <CircleHelp size={18} />
            </a>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Разделы">
          <button type="button" className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
            <MessageSquareText size={14} /> Чат
          </button>
          <button type="button" className={view === 'images' ? 'active' : ''} onClick={() => setView('images')}>
            <ImageIcon size={14} /> Изображения
          </button>
          <button type="button" className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>
            <ListTodo size={14} /> Задачи
          </button>
        </nav>

        {view === 'chat' && (
          <section className="chat-view">
            {!activeConversation?.messages.length ? (
              <div className="welcome-screen">
                <div className="welcome-orbit">
                  <div className="welcome-orbit-ring" />
                  <div className="welcome-glow"><Sparkles size={30} /></div>
                  <span className="orbit-dot orbit-dot-one" />
                  <span className="orbit-dot orbit-dot-two" />
                </div>
                <div className="eyebrow"><span className="eyebrow-line" /> ВАШ AI-ПОМОЩНИК <span className="eyebrow-line" /></div>
                <h1>Идеи становятся<br /><span>действиями.</span></h1>
                <p className="welcome-copy">Задайте вопрос, найдите информацию или поручите мне кодовую задачу.<br className="desktop-break" /> Я помогу превратить идею в следующий шаг.</p>
                {!health?.configured && (
                  <div className="setup-notice">
                    <span className="setup-notice-icon"><Settings2 size={16} /></span>
                    <span>Для работы AI добавьте <code>GEMINI_API_KEY</code> в локальный <code>.env</code>.</span>
                  </div>
                )}
                {apiError && <p className="inline-error">{apiError}</p>}
                <div className="prompt-grid">
                  {starterPrompts.map(({ icon: Icon, title, prompt }) => (
                    <button className="prompt-card" type="button" key={title} onClick={() => void sendMessage(prompt)}>
                      <span className="prompt-icon"><Icon size={17} /></span>
                      <span>{title}</span>
                      <ArrowUp className="prompt-arrow" size={15} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="message-scroll">
                <div className="message-list">
                  {activeConversation.messages.map((message) => (
                    <article className={`message ${message.role}`} key={message.id}>
                      {message.role === 'assistant' && <div className="message-avatar"><Sparkles size={15} /></div>}
                      <div className="message-body">
                        <div className="message-author">{message.role === 'assistant' ? 'Nura' : 'Вы'}</div>
                        {message.loading ? (
                          <div className="typing-indicator" aria-label="Nura печатает">
                            <span /><span /><span />
                          </div>
                        ) : (
                          <div className="message-text">
                            {message.role === 'assistant' ? displayMessageText(message.text) : message.text}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}

            <div className="composer-wrap">
              {activeConversation?.messages.length ? (
                <div className="composer-hint">
                  <Sparkles size={13} />
                  {health?.configured ? 'Ответы создаются с помощью Gemini' : 'Добавьте API-ключ, чтобы получать ответы'}
                </div>
              ) : null}
              <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
                <textarea
                  ref={composerRef}
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                  placeholder="Напишите сообщение..."
                  rows={1}
                  maxLength={8000}
                  aria-label="Ваше сообщение"
                />
                <div className="composer-footer">
                  <div className="composer-tools">
                    <button className="composer-tool" type="button" onClick={() => setView('images')} title="Создать изображение">
                      <ImageIcon size={16} /><span>Создать изображение</span>
                    </button>
                  </div>
                  <div className="composer-submit-area">
                    <span className="composer-shortcut">↵ отправить</span>
                    <button className="send-button" type="submit" disabled={!messageDraft.trim() || sending} aria-label="Отправить сообщение">
                      {sending ? <LoaderCircle className="spin" size={17} /> : <Send size={16} />}
                    </button>
                  </div>
                </div>
              </form>
              <p className="disclaimer">AI может ошибаться. Проверяйте важную информацию.</p>
            </div>
          </section>
        )}

        {view === 'images' && (
          <section className="tool-view image-view">
            <div className="tool-heading">
              <div className="tool-kicker"><span className="tool-kicker-icon"><ImageIcon size={15} /></span> ТВОРЧЕСКАЯ СТУДИЯ</div>
              <h1>Вообразите.<br /><span>Мы создадим.</span></h1>
              <p>Опишите идею — Gemini превратит её в изображение.</p>
            </div>
            <form className="image-prompt-card" onSubmit={(event) => void generateImage(event)}>
              <label htmlFor="image-prompt">Опишите изображение</label>
              <textarea
                id="image-prompt"
                value={imagePrompt}
                onChange={(event) => setImagePrompt(event.target.value)}
                placeholder="Например: уютная кофейня на Марсе в стиле кинематографичной фотографии..."
                rows={4}
                maxLength={4000}
              />
              <div className="image-form-footer">
                <span><Sparkles size={14} /> Подробное описание улучшает результат</span>
                <button className="primary-button" type="submit" disabled={!imagePrompt.trim() || generatingImage || !health?.configured}>
                  {generatingImage ? <><LoaderCircle className="spin" size={16} /> Создаём...</> : <><WandSparkles size={16} /> Создать изображение</>}
                </button>
              </div>
            </form>
            {imageError && <div className="error-banner">{imageError}</div>}
            {!health?.configured && (
              <div className="setup-notice image-setup">
                <Settings2 size={16} /> Сначала добавьте Gemini API-ключ в <code>.env</code>.
              </div>
            )}
            {generatingImage && (
              <div className="image-loading">
                <div className="image-loading-art"><Sparkles size={26} /></div>
                <strong>Создаём вашу идею</strong>
                <span>Это может занять несколько секунд</span>
              </div>
            )}
            {imageUrl && !generatingImage && (
              <div className="generated-image-card">
                <img src={imageUrl} alt={imagePrompt} />
                <div className="generated-image-footer">
                  <span><CheckCheck size={16} /> Изображение готово</span>
                  <a className="download-button" href={imageUrl} download="nura-ai-image.png">
                    <ArrowDownToLine size={16} /> Скачать
                  </a>
                </div>
              </div>
            )}
            {!imageUrl && !generatingImage && (
              <div className="inspiration">
                <div className="section-label">ИЛИ НАЧНИТЕ С ИДЕИ</div>
                <div className="inspiration-grid">
                  {imagePrompts.map((prompt, index) => (
                    <button
                      type="button"
                      className={`inspiration-card inspiration-${index + 1}`}
                      key={prompt}
                      onClick={() => setImagePrompt(prompt)}
                    >
                      <span>{prompt}</span><ArrowUp size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'tasks' && (
          <section className="tool-view tasks-view">
            <div className="tool-heading">
              <div className="tool-kicker"><span className="tool-kicker-icon"><ListTodo size={15} /></span> ЛИЧНЫЙ WORKSPACE</div>
              <h1>Меньше хаоса.<br /><span>Больше фокуса.</span></h1>
              <p>Соберите задачи и заметки в одном месте. Данные хранятся только в этом браузере.</p>
            </div>
            <TaskBoard
              tasks={tasks}
              taskDraft={taskDraft}
              setTaskDraft={setTaskDraft}
              addTask={addTask}
              setTasks={setTasks}
              notes={notes}
              noteDraft={noteDraft}
              setNoteDraft={setNoteDraft}
              addNote={addNote}
              setNotes={setNotes}
              expanded
            />
          </section>
        )}
      </main>

      <aside className={panelOpen ? 'workspace-panel mobile-open' : 'workspace-panel'}>
        <div className="workspace-header">
          <div><span className="sidebar-label">ВАШ WORKSPACE</span><h2>План и заметки</h2></div>
          <button className="icon-button panel-close" type="button" onClick={() => setPanelOpen(false)} aria-label="Закрыть панель"><X size={17} /></button>
        </div>
        <div className="workspace-tabs">
          <button type="button" className={panelTab === 'tasks' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => setPanelTab('tasks')}>
            <ListTodo size={15} /> Задачи <span>{pendingTasks}</span>
          </button>
          <button type="button" className={panelTab === 'notes' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => setPanelTab('notes')}>
            <FileText size={15} /> Заметки <span>{notes.length}</span>
          </button>
        </div>
        <TaskBoard
          tasks={tasks}
          taskDraft={taskDraft}
          setTaskDraft={setTaskDraft}
          addTask={addTask}
          setTasks={setTasks}
          notes={notes}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          addNote={addNote}
          setNotes={setNotes}
          panelTab={panelTab}
        />
        <div className="workspace-footnote"><Clock3 size={13} /> Сохраняется автоматически</div>
      </aside>

      {profileOpen && (
        <div
          className="account-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProfileOpen(false)
          }}
        >
          <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
            <button
              className="icon-button account-close"
              type="button"
              onClick={() => setProfileOpen(false)}
              aria-label="Закрыть окно аккаунта"
            >
              <X size={17} />
            </button>
            <div className="account-mark"><Sparkles size={20} /></div>
            <h2 id="account-title">{googleUser ? 'Ваш аккаунт' : 'Войти в Nura AI'}</h2>
            <p className="account-description">
              {googleUser ? 'Вы вошли с аккаунтом Google.' : 'Используйте аккаунт Google для входа в профиль.'}
            </p>
            {googleUser ? (
              <div className="account-user">
                {googleUser.picture ? (
                  <img className="account-avatar" src={googleUser.picture} alt="" />
                ) : (
                  <span className="account-avatar account-avatar-fallback">{googleUser.name.slice(0, 1).toUpperCase()}</span>
                )}
                <span><strong>{googleUser.name}</strong><small>{googleUser.email}</small></span>
              </div>
            ) : (
              <>
                {!health?.googleClientId && (
                  <p className="account-error">Добавьте GOOGLE_CLIENT_ID в .env и перезапустите сервер.</p>
                )}
                {health?.googleClientId && googleScriptReady && (
                  <div className="google-button-wrap" ref={googleButtonRef} />
                )}
                {health?.googleClientId && !googleScriptReady && (
                  <p className="account-description">Загружаем вход Google...</p>
                )}
                {health?.googleClientId && (
                  <p className="account-setup-note">
                    Разрешите источник <code>{window.location.origin}</code> в настройках{' '}
                    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                      OAuth Client ID в Google Cloud
                    </a>.
                  </p>
                )}
                {googleAuthLoading && <p className="account-description">Проверяем аккаунт Google...</p>}
              </>
            )}
            {googleAuthError && <p className="account-error">{googleAuthError}</p>}
            {googleUser && (
              <button className="account-signout" type="button" onClick={() => void signOutGoogle()}>
                Выйти из аккаунта
              </button>
            )}
            <p className="account-footnote">Вход в приложение не меняет лимиты Gemini API.</p>
          </section>
        </div>
      )}

      <button className="mobile-workspace-toggle" type="button" onClick={() => setPanelOpen(true)} aria-label="Открыть задачи и заметки">
        <ListTodo size={18} /> {pendingTasks > 0 && <span>{pendingTasks}</span>}
      </button>
    </div>
  )
}

type TaskBoardProps = {
  tasks: Task[]
  taskDraft: string
  setTaskDraft: (value: string) => void
  addTask: (event: React.FormEvent<HTMLFormElement>) => void
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  notes: Note[]
  noteDraft: string
  setNoteDraft: (value: string) => void
  addNote: (event: React.FormEvent<HTMLFormElement>) => void
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  panelTab?: 'tasks' | 'notes'
  expanded?: boolean
}

function TaskBoard({
  tasks,
  taskDraft,
  setTaskDraft,
  addTask,
  setTasks,
  notes,
  noteDraft,
  setNoteDraft,
  addNote,
  setNotes,
  panelTab = 'tasks',
  expanded = false,
}: TaskBoardProps) {
  return (
    <div className={expanded ? 'task-board expanded' : 'task-board'}>
      {(panelTab === 'tasks' || expanded) && (
        <section className="board-section">
          <div className="board-section-heading">
            <div><h3>Задачи</h3><span>{tasks.filter((task) => !task.done).length} осталось</span></div>
          </div>
          <form className="quick-add" onSubmit={addTask}>
            <input value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder="Добавить задачу..." maxLength={180} aria-label="Новая задача" />
            <button type="submit" disabled={!taskDraft.trim()} aria-label="Добавить"><Plus size={17} /></button>
          </form>
          <div className="task-list">
            {tasks.length === 0 && <p className="empty-state">Пока нет задач.<br />Добавьте первую выше.</p>}
            {tasks.map((task) => (
              <div className={task.done ? 'task-row done' : 'task-row'} key={task.id}>
                <button
                  className="task-check"
                  type="button"
                  onClick={() => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))}
                  aria-label={task.done ? 'Вернуть задачу в работу' : 'Отметить выполненной'}
                >
                  {task.done && <Check size={12} />}
                </button>
                <span>{task.title}</span>
                <button className="task-delete" type="button" onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))} aria-label="Удалить задачу">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(panelTab === 'notes' || expanded) && (
        <section className="board-section notes-section">
          <div className="board-section-heading">
            <div><h3>Заметки</h3><span>Ваши идеи и мысли</span></div>
          </div>
          <form className="note-form" onSubmit={addNote}>
            <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Запишите идею или важную мысль..." rows={3} maxLength={1200} aria-label="Новая заметка" />
            <button className="note-submit" type="submit" disabled={!noteDraft.trim()}><Plus size={15} /> Сохранить</button>
          </form>
          <div className="note-list">
            {notes.length === 0 && <p className="empty-state">Заметки появятся здесь.</p>}
            {notes.map((note) => (
              <article className="note-card" key={note.id}>
                <div className="note-card-icon"><FileText size={14} /></div>
                <p>{note.text}</p>
                <button className="task-delete" type="button" onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))} aria-label="Удалить заметку">
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default App
