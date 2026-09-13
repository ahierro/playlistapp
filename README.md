# Playlist App

App de Next.js (App Router) + React que te deja entrar con Spotify y lista todos los artistas que seguís.

## Stack

- **Next.js 16** (App Router, Server Components, route handlers)
- **React 19**
- **Auth.js v5** (`next-auth@beta`) con el provider de Spotify y refresh de token automático
- **Tailwind CSS v4** + componentes **shadcn/ui**
- **TypeScript** estricto

## Puesta en marcha

### 1. Crear la app en Spotify

1. Entrá a <https://developer.spotify.com/dashboard> y creá una app.
2. En **Redirect URIs** agregá exactamente:

   ```
   http://127.0.0.1:3000/api/auth/callback/spotify
   ```

   > **Importante:** Spotify **no acepta `localhost`** como redirect URI, hay que usar el IP literal `127.0.0.1`. Por eso el dev server hay que abrirlo en `http://127.0.0.1:3000` y no en `http://localhost:3000` (si no, el `state` de OAuth queda en otro dominio y el callback falla).

3. En **APIs used** marcá **Web API**.
4. Copiá el **Client ID** y el **Client Secret**.

### ⚠️ Development Mode después de febrero 2026

Spotify [endureció el acceso de desarrollo](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security).
Toda app nueva nace con estas reglas:

| Regla | Detalle |
| --- | --- |
| **Spotify Premium** | El dueño de la app necesita una suscripción Premium activa. |
| **Client IDs** | 1 por developer (subió a 25 en julio 2026). |
| **Usuarios autorizados** | Hasta **5**, agregados a mano en **Settings → User Management**. Otra cuenta recibe `403`. |
| **Endpoints** | Sólo el [set soportado de febrero 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026). |

Development Mode es un sandbox para aprender y proyectos personales, no una base para
escalar un producto.

#### Qué de esto afecta a esta app

- `GET /me/following` (artistas seguidos) y `GET /me` (perfil) **siguen soportados**. El core funciona.
- El objeto **Artist** perdió `followers` y `popularity`. `src/lib/spotify.ts` los declara opcionales y
  `ArtistCard` los muestra sólo si llegan, así que no rompe en ninguno de los dos casos.
- El objeto **User** perdió `email`, `country`, `product`, `explicit_content` y `followers`. Por eso
  **no pedimos el scope `user-read-email`** y el header muestra sólo el display name y la foto.
- `PUT`/`DELETE /me/following` (seguir y dejar de seguir) fueron removidos y reemplazados por los
  endpoints unificados `PUT`/`DELETE /me/library`, que toman URIs en vez de IDs. A tener en cuenta si
  más adelante querés agregar "dejar de seguir" desde la app.

### 2. Variables de entorno

Copiá `.env.example` a `.env.local` y completá:

```bash
AUTH_SPOTIFY_ID=tu_client_id
AUTH_SPOTIFY_SECRET=tu_client_secret
AUTH_SECRET=  # generalo con: npx auth secret
```

### 3. Instalar y correr

```bash
npm install
npm run dev
```

Abrí **<http://127.0.0.1:3000>**.

## Cómo funciona

```
src/
├── auth.ts                                # config de Auth.js: provider, scopes, refresh de token
├── app/
│   ├── api/auth/[...nextauth]/route.ts    # handlers de login/callback/logout
│   ├── api/spotify/following/route.ts     # paginación: el cliente pide acá, el token no sale del server
│   ├── page.tsx                           # landing + botón de login (redirige si ya hay sesión)
│   └── artists/page.tsx                   # primera página de artistas, renderizada en el server
├── components/
│   ├── auth-buttons.tsx                   # server actions signIn / signOut
│   ├── followed-artists.tsx               # client component: "cargar más" + filtro
│   └── artist-card.tsx
└── lib/spotify.ts                         # cliente de la Web API + tipos + errores
```

### Autenticación

- Flujo **Authorization Code** manejado por Auth.js. Único scope pedido: `user-follow-read`.
- La sesión es un **JWT en cookie httpOnly**. El `access_token` de Spotify vive ahí y **nunca se manda al browser**: el client component pide los datos a `/api/spotify/following` y el server agrega el header `Authorization`.
- El access token de Spotify dura 1 hora. El callback `jwt` lo renueva solo con el `refresh_token` (con 60s de margen). Si el refresh falla, la sesión queda marcada con `error: "RefreshTokenError"` y la app te manda de vuelta al login.

### Artistas seguidos

`GET /v1/me/following?type=artist` usa **paginación por cursor**, no por offset: cada respuesta trae
`cursors.after`, que es el id del último artista. La primera página (50 artistas) se renderiza en el
server; las siguientes las pide el client component con ese cursor.

## Troubleshooting: `redirect_uri: Not matching configuration`

Si Spotify te rechaza el login con ese mensaje, mirá el `redirect_uri` en la URL a la que
te mandó. Si dice `localhost`, es este problema:

- Spotify **exige** el IP literal (`http://127.0.0.1:3000/...`) y rechaza `localhost`.
- El dev server de **Next 16 normaliza `request.url` a `http://localhost:PORT`** aunque el
  header `Host` diga `127.0.0.1` (verificado: `Host: 127.0.0.1:3000` →
  `request.url: http://localhost:3000/...`).
- Auth.js deriva el `redirect_uri` de esa URL (`parseProviders` usa `params.url.origin`),
  así que termina mandando `localhost` y Spotify lo rechaza.

Cosas que **no** lo arreglan, ya probadas:

| Intento | Por qué falla |
| --- | --- |
| Entrar por `http://127.0.0.1:3000` | Next normaliza igual; el `redirect_uri` sigue diciendo `localhost`. |
| `AUTH_URL=http://127.0.0.1:3000` | `reqWithEnvURL` reconstruye el `NextRequest` y Next vuelve a normalizar el origin. |
| `next dev -H 127.0.0.1` | Mismo resultado: `request.url` sigue siendo `localhost`. |
| `authorization.params.redirect_uri` | Arregla el authorize, pero el intercambio del code usa `provider.callbackUrl` → `invalid_grant`. |
| Editar el archivo `hosts` del SO | El `hosts` resuelve nombres a IPs; acá el problema es el string que emite Next, no la resolución. Y un nombre propio tampoco sirve: Spotify exige HTTPS salvo para loopback literal. |

**La solución** está en `src/app/api/auth/[...nextauth]/route.ts`: un wrapper que reescribe el
origin del request a `AUTH_DEV_ORIGIN` antes de pasárselo a Auth.js, sólo en desarrollo. Como
tanto el authorize como el token exchange salen de ese mismo origin, quedan coherentes.

Si cambiás el puerto del dev server, actualizá `AUTH_DEV_ORIGIN` en `.env.local` **y** el
Redirect URI en el dashboard de Spotify.

## Scripts

```bash
npm run dev     # dev server
npm run build   # build de producción
npm run start   # servir el build
npm run lint    # eslint
```

## Próximos pasos

- Scroll infinito con `IntersectionObserver` en vez del botón "Cargar más".
- Listar y crear playlists (scopes `playlist-read-private`, `playlist-modify-private`; los endpoints de playlists siguen soportados).
- Cachear las páginas ya traídas (`unstable_cache` o React Query) para no repegarle a Spotify.
