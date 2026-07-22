# DJI Cloud API — Reference

> Documento de referencia interno para el equipo de **AeroAdmin AFM**.
> Compilado desde la doc oficial (fuente de verdad: https://github.com/dji-sdk/Cloud-API-Doc)
> y el sitio https://developer.dji.com/doc/cloud-api-tutorial/en/.
> Última actualización: 2026-07-22.

---

## TL;DR

Cloud API es el sistema oficial de DJI para que un dron enterprise (con DJI Pilot 2 o DJI Dock) publique telemetría en tiempo real a un broker MQTT propio, sin tener que desarrollar una app móvil custom (MSDK).

**Para nuestro caso (M3M):** Cloud API **NO** incluye al M3M en la lista "Pilot 2" oficial. El M3M aparece en listas broad de "productos soportados" pero requiere integración a través de **DJI SmartFarm Web**, no Pilot 2, lo cual hace el setup significativamente más complejo. Para el MVP de AeroAdmin AFM, **NO usar Cloud API** — usar `dji-log-parser` + import manual de `.txt` del dron.

---

## 1. Supported Products (lista oficial Cloud-API-Doc)

> Fuente: https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/10.overview/30.product-support.md

| Aircraft | Gateway | Payload | Comentario |
|---|---|---|---|
| Matrice 3D / Matrice 3TD | DJI Dock 2 | — | No soporta third-party payload |
| Matrice 350 RTK | DJI RC Plus + DJI Pilot 2 | H20/H20T/H20N/H30/H30T | No soporta third-party payload |
| Matrice 300 RTK | DJI RC Plus + DJI Pilot 2 | H20/H20T/H20N/H30/H30T | No soporta third-party payload |
| Matrice 300 RTK | DJI Smart Controller Enterprise + DJI Pilot 2 | H20/H20T/H20N/H30/H30T | No soporta third-party payload |
| Matrice 30 / 30T | DJI RC Plus + DJI Pilot 2 | — | No soporta third-party payload |
| Matrice 30 / 30T | DJI Dock | — | No soporta third-party payload |
| DJI Mavic 3 Enterprise Series (M3E / M3T) | DJI RC Pro + DJI Pilot 2 | — | No soporta third-party payload |

**NO soportados oficialmente:** M200 V2, M200, M2E, P4R, M2EA, **M3M (Mavic 3 Multispectral)**.

**Ambigüedad detectada:** la página `/cloud-api/` del sitio DJI Developer y el SDK Forum mencionan M3M en una lista "broader" de productos soportados, pero el doc canónico (`product-support.md` en GitHub) no lo incluye en la tabla de gateways. Conclusión: M3M **puede** funcionar vía SmartFarm Web como gateway implícito, pero **no está documentado** y el setup requiere experimentación con soporte DJI.

### Enumeración de productos (type / sub_type)

| Producto | type | sub_type |
|---|---|---|
| Matrice 350 RTK | 89 | 0 |
| Matrice 300 RTK | 60 | 0 |
| Matrice 30 | 67 | 0 |
| Matrice 30T | 67 | 1 |
| Mavic 3 Enterprise (M3E) | 77 | 0 |
| Mavic 3 Enterprise (M3T) | 77 | 1 |
| Matrice 3D | 91 | 0 |
| Matrice 3TD | 91 | 1 |
| DJI Smart Controller Enterprise | 56 | 0 |
| DJI RC Plus | 119 | 0 |
| DJI RC Pro Enterprise | 144 | 0 |
| DJI Dock | 1 | 0 |
| DJI Dock 2 | 2 | 0 |

---

## 2. Arquitectura

```
   DJI Pilot 2 / DJI Dock / DJI SmartFarm Web
                    │
                    │  MQTT 5.0
                    ▼
         ┌────────────────────┐
         │  Tu EMQX broker    │  (corazón del sistema)
         │  (Docker, port 1883)│
         └─────────┬──────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   MySQL DB   Redis Cache   Object Storage
   (state,    (sessions,    (S3 / Aliyun OSS /
   config)    pubsub)       MinIO)
        │
        ▼
   Tu backend (Spring Boot / Node / Go)
   - Auth con App License
   - Webview H5 para login desde Pilot 2
   - Persistencia de telemetría
        │
        ▼
   AeroAdmin AFM (esta app)
   - Lee de MySQL
   - Muestra dashboard, mapa, etc.
```

**Componentes requeridos si implementás Cloud API full:**
- EMQX broker (MQTT 5.0, default port 1883)
- MySQL 8.x
- Redis
- Object storage (S3 / OSS / MinIO) — opcional si no usás media library
- Backend (oficial demo es Java Spring Boot, puede reescribirse en Node/Go)
- Webview H5 con JSBridge para autenticación desde Pilot 2

---

## 3. MQTT Topics

### Prefijos

| Categoría | Prefijo | Uso |
|---|---|---|
| Basic Topic | `sys/` | Lifecycle, registro, online/offline |
| Thing Model Topic | `thing/` | Property, service, event del dispositivo |

### Lista completa de topics

| Topic | Dirección | Sender | Uso |
|---|---|---|---|
| `thing/product/{device_sn}/osd` | up | Device → Cloud | Telemetría en tiempo real (lat, lon, alt, batería, actitud...) — alta frecuencia |
| `thing/product/{device_sn}/state` | up | Device → Cloud | Cambios de estado (baja frecuencia) |
| `thing/product/{gateway_sn}/services` | down | Cloud → Device | Comandos al dron |
| `thing/product/{gateway_sn}/services_reply` | up | Device → Cloud | Resultado de comandos |
| `thing/product/{gateway_sn}/events` | up | Device → Cloud | Eventos (despegue, aterrizaje, SD lleno, etc.) |
| `thing/product/{gateway_sn}/events_reply` | down | Cloud → Device | Ack de eventos |
| `thing/product/{gateway_sn}/requests` | up | Device → Cloud | Pedidos del dron (credenciales, etc.) |
| `thing/product/{gateway_sn}/requests_reply` | down | Cloud → Device | Respuesta a pedidos |
| `thing/product/{gateway_sn}/property/set` | down | Cloud → Device | Set de propiedad (si `accessMode = 2`) |
| `thing/product/{gateway_sn}/property/set_reply` | up | Device → Cloud | Ack del set |
| `thing/product/{gateway_sn}/drc/up` | up | Device → Cloud | Live flight controls (DRC) |
| `thing/product/{gateway_sn}/drc/down` | down | Cloud → Device | Comandos live DRC |
| `sys/product/{gateway_sn}/status` | up | Device → Cloud | Online/offline, topology update |
| `sys/product/{gateway_sn}/status_reply` | down | Cloud → Device | Ack de status |

> **{device_sn}** = serial del dron
> **{gateway_sn}** = serial del gateway (RC Plus, RC Pro, Dock, etc.)

### Campos comunes en el payload

| Campo | Tipo | Descripción |
|---|---|---|
| `tid` | text (UUID) | Transaction ID para matchear request/response |
| `bid` | text (UUID) | Business ID (sesión de negocio de larga duración) |
| `timestamp` | int (ms) | Timestamp del mensaje (13 dígitos) |
| `gateway` | text | Serial del gateway |
| `data` | object | Payload específico |

---

## 4. Estructura de mensajes (ejemplos)

### OSD — telemetría de dron (M30, en este ejemplo)

```json
{
  "tid": "43d2e632-1558-4c4e-83d2-eeb51b7a377a",
  "bid": "7578f2ac-1f12-4d47-9ab6-5de146ed7b8a",
  "timestamp": 1667220916697,
  "gateway": "dock_sn",
  "data": {
    "latitude": 22.907809968,
    "longitude": 113.703482143,
    "height": 34.174,
    "environment_temperature": 24,
    "wind_speed": 0,
    "position_state": {
      "is_calibration": 1,
      "is_fixed": 2,
      "quality": 5,
      "gps_number": 6,
      "rtk_number": 25
    },
    "sub_device": {
      "device_sn": "1581F5BKD225D00BP891",
      "device_model_key": "0-67-0",
      "device_online_status": 0
    }
  }
}
```

### Status — topología (gateway + sub-devices)

```json
{
  "tid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx",
  "method": "update_topo",
  "timestamp": 1234567890123,
  "data": {
    "type": 98,
    "sub_type": 0,
    "device_secret": "secret",
    "nonce": "nonce",
    "version": 1,
    "sub_devices": [
      {
        "sn": "drone001",
        "type": 116,
        "sub_type": 0,
        "index": "A",
        "device_secret": "secret",
        "nonce": "nonce",
        "version": 1
      }
    ]
  }
}
```

### Services / Events / Requests (mismo patrón)

```json
{
  "tid": "6a7bfe89-c386-4043-b600-b518e10096cc",
  "bid": "42a19f36-5117-4520-bd13-fd61d818d52e",
  "timestamp": 1598411295123,
  "gateway": "sn",
  "method": "some_method",
  "data": {}
}
```

---

## 5. Setup del Demo oficial (DJI)

> Fuente: https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/20.quick-start/20.source-code-deployment-steps.md
> ⚠️ **DJI anunció (junio 2025) que discontinuó el soporte oficial del demo.** El código sigue siendo usable como referencia, pero no esperes parches.

### Paso 1 — Registrar como DJI Developer
https://account.dji.com/register?appId=dji_sdk&backUrl=https%3A%2F%2Fdeveloper.dji.com%2Fuser

Requiere email + tarjeta de crédito (verificación, no cobro).

### Paso 2 — Crear licencia de Cloud API
DJI Developer Center → Apps → Create App → **App Type: Cloud API**.

Recibirás:
- `appId`
- `appKey`
- `appLicense`

Estos van en `src/api/http/config.ts` (frontend) y `application.yml` (backend).

### Paso 3 — Stack requerido
| Componente | Versión | Notas |
|---|---|---|
| Java JDK | 1.8+ | Backend |
| Maven | 3.6+ | Build |
| EMQX | 4.4+ | Broker MQTT (Docker) |
| MySQL | 8.0+ | Persistencia |
| Redis | latest | Cache/sessions |
| Node.js + npm | LTS | Frontend |

### Paso 4 — Levantar EMQX (Docker)

```bash
docker run -d --name emqx \
  -p 1883:1883 -p 8083:8083 -p 8084:8084 \
  -p 8883:8883 -p 18083:18083 \
  emqx:5.0.20
```

Dashboard: http://localhost:18083 (admin/public por default).

### Paso 5 — Init MySQL

```bash
mysql -u root -p
source /path/to/DJI-Cloud-API-Demo/sql/cloud_sample.sql
```

### Paso 6 — Configurar backend

`src/main/resources/application.yml`:
- MySQL connection
- MQTT connection (broker host, port, user/pass)
- Redis connection
- Object storage (opcional)

### Paso 7 — Levantar frontend

```bash
git clone https://github.com/dji-sdk/Cloud-API-Demo-Web
cd Cloud-API-Demo-Web
npm install
npm run serve
```

Editá `src/api/http/config.ts` con tu `appId`, `appKey`, `appLicense`.

### Paso 8 — Login desde Pilot 2

Pilot 2 → Cloud Services → Open Platforms → URL: `http://<server-ip>:8080/pilot-login` → Connect.

Credenciales default del demo: `pilot` / `pilot123`.

### Paso 9 — Login web admin

`http://<server-ip>:8080/project` → `adminPC` / `adminPC`.

---

## 5b. Tutorial Map — estructura completa del tutorial oficial

El tutorial se divide en 2 grandes bloques: **Basic Introduction** y **Function Set**. Dentro de Function Set hay **15 features**, cada una con su implementación distinta según uses **Pilot 2** o **DJI Dock**.

### Las 15 features

| # | Feature | Pilot 2 (JSBridge) | Pilot 2 (HTTPS) | Pilot 2 (WebSocket) | DJI Dock (MQTT) |
|---|---|---|---|---|---|
| 1 | Pilot access to Cloud | ✅ | — | — | — |
| 2 | Dock access to Cloud | — | — | — | ✅ |
| 3 | Live stream | ✅ + MQTT | — | — | ✅ |
| 4 | Wayline Management | ✅ | ✅ | — | ✅ |
| 5 | Map elements | ✅ | ✅ | ✅ | — |
| 6 | Media library | ✅ | ✅ | — | ✅ |
| 7 | Situation awareness | ✅ | ✅ | ✅ | — |
| 8 | Device Management | TBD | — | — | ✅ |
| 9 | Obtain log through JSBridge | ✅ | — | — | — |
| 10 | Jump to third-party App | ✅ | — | — | — |
| 11 | HMS Function | — | — | — | ✅ |
| 12 | Remote Debug | — | — | — | ✅ |
| 13 | Firmware Upgrade | — | — | — | ✅ |
| 14 | Remote Log | — | — | — | ✅ |
| 15 | Live Flight Controls | — | — | — | ✅ |

**Conclusión clave:** de las 15 features, **9 son exclusivas de DJI Dock** (no aplican a Pilot 2 / M3E / M3T). Las features 1, 5, 7, 9, 10 son exclusivas de Pilot 2. Solo la 3 (live stream) cruza ambos. Y el M3M (Mavic 3 Multispectral) no figura en ningún feature directamente — su integración con Cloud API sería un caso excepcional vía SmartFarm Web, no documentado.

### Key Functions Development (DJI strongly recommends para SAFETY)

DJI enfatiza que **antes** de usar Cloud API en producción tenés que implementar:

- **Remote Log** — extracción de logs del dispositivo a pedido
- **Firmware Upgrade** — forzar/ofrecer upgrade de firmware
- **HMS Function** — Health Monitoring System (alarmas de salud del dron)
- **Remote Debugging** — control remoto de misiones para soporte
- **Locate Last Known Position** — última posición conocida del dron
- **Record Task Plan Library History** — historial de waylines ejecutadas

> Estas 6 features son **de seguridad operacional**. Si en algún momento integrás Cloud API con un Dock, no escatimes acá. DJI las lista como obligatorias para tener traceability si hay un incidente.

### API Overview — lo que solo el Dock tiene

- **Device Property Set** API: solo DJI Dock
- **Set livestream lens** API: solo DJI Dock
- Si tu cloud service no tiene acceso a Internet (WAN), tenés que implementar `update_configuration` para mandar la URL de tu NTP server propio. Si no, las wayline tasks no funcionan.

### FAQ highlights

**1. Take Photo (Fixed Angle) vs AI Spot-Check (Dock 2):**
- `orientedShoot` (Take Photo Fixed Angle) > `accurateShoot` (AI Spot-Check) en compatibilidad y eficiencia
- Si migrás de AI Spot-Check, hay que cambiar `accurateShoot` → `orientedShoot`, agregar `actionUUID` (UUID v4), setear `orientedPhotoMode` (`normalPhoto` o `lowLightSmartShooting`), y renombrar todos los campos `accurate*` a `oriented*` (excepto `accurateFrameValid`).
- Solo aplica a Dock / Dock 2.

**2. Multi-dock tasks y Controller B:**
- En tareas multi-dock con takeoff y landing separados, el controller B se desconecta (link ocupado).
- Solo si tenés múltiples docks, no es nuestro caso.

**3. Timeout 40 segundos en takeoff/wayline:**
- Si no respondés a `offline_map_get` o `flight_areas_get`, el Dock espera 40s antes de hacer fallback.
- **Fix 1:** upgrade firmware Dock 2 a v10.01.32.02.
- **Fix 2:** responder manualmente con `result: 0` a esos dos métodos. Topics:
  - `thing/product/{gateway_sn}/requests_reply` con `method: flight_areas_get` o `offline_map_get`.

---

### FAQ highlights

**1. Take Photo (Fixed Angle) vs AI Spot-Check (Dock 2):**
- `orientedShoot` (Take Photo Fixed Angle) > `accurateShoot` (AI Spot-Check) en compatibilidad y eficiencia
- Si migrás de AI Spot-Check, hay que cambiar `accurateShoot` → `orientedShoot`, agregar `actionUUID` (UUID v4), setear `orientedPhotoMode` (`normalPhoto` o `lowLightSmartShooting`), y renombrar todos los campos `accurate*` a `oriented*` (excepto `accurateFrameValid`).
- Solo aplica a Dock / Dock 2.

**2. Multi-dock tasks y Controller B:**
- En tareas multi-dock con takeoff y landing separados, el controller B se desconecta (link ocupado).
- Solo si tenés múltiples docks, no es nuestro caso.

**3. Timeout 40 segundos en takeoff/wayline:**
- Si no respondés a `offline_map_get` o `flight_areas_get`, el Dock espera 40s antes de hacer fallback.
- **Fix 1:** upgrade firmware Dock 2 a v10.01.32.02.
- **Fix 2:** responder manualmente con `result: 0` a esos dos métodos. Topics:
  - `thing/product/{gateway_sn}/requests_reply` con `method: flight_areas_get` o `offline_map_get`.

---

## 5c. Environment prepare list + Docker deployment

> Fuentes:
> - https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/20.quick-start/10.environment-prepare-list.md
> - https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/20.quick-start/30.docker-deployment-steps.md

### Stack técnico del demo oficial

**Backend (Java Spring Boot):**
- Java **JDK 11+** (REQUERIDO, no compila con 8)
- Spring Boot
- MQTT (cliente para EMQX)
- MySQL 8.0.26
- Redis 6.2
- WebSocket

**Frontend (Vue 3 + TypeScript):**
- Vue 3.0.5
- Node.js 17.8
- TypeScript, HTML, CSS
- Ant Design Vue v2
- HTTP / WebSocket
- Nginx 1.20.2 (en producción)
- AMap (Gaode Maps) para el mapa — **requiere API key china**, no sirve directo para Colombia

**Infraestructura:**
- Linux Ubuntu 16.04+ (target oficial — Windows no es target de producción)
- EMQX 4.4.0 (broker MQTT)
- Object storage (default: Aliyun OSS, configurable a S3 / MinIO)

### Docker pre-armado (la parte interesante)

DJI provee un `cloud_api_sample_docker_v1.0.0.tar` con todo el stack pre-configurado:

```
cloud_api_sample_docker/
├── data/                              # user data al correr
├── docker-compose.yml                 # stack completo: back + front + EMQX + MySQL + Redis
├── docs/                              # API docs auto-generados
├── source/
│   ├── backend_service/sample/...     # código Spring Boot
│   ├── nginx/front_page/src/api/...   # código Vue + config.ts
│   └── ...
├── cloud_api_sample_docker_v1.0.0.tar # imagen Docker completa
├── update_backend.sh                  # rebuild back image
├── update_front.sh                    # rebuild front image
└── README.md
```

**Setup con Docker (teórico, 30 min si todo sale bien):**

```bash
docker load < cloud_api_sample_docker_v1.0.0.tar
# Editar source/backend_service/sample/src/main/resources/application.yml
# Editar source/nginx/front_page/src/api/http/config.ts con tu appId/appKey/appLicense
./update_front.sh
./update_backend.sh
sudo docker-compose up -d
```

Web admin: `http://<server-ip>:8080/project` (adminPC/adminPC)
Pilot 2 login: `http://<server-ip>:8080/pilot-login` (pilot/pilot123)

### ¿Qué nos sirve de todo esto para AeroAdmin AFM?

**Respuesta honesta: parcialmente.**

| Componente | Útil para nosotros? | Por qué |
|---|---|---|
| Docker pre-armado | ❌ No para MVP | El demo solo sirve con un drone enterprise conectado vía Pilot 2. Sin M3E/Dock, el Docker corre pero no hace nada útil. |
| EMQX broker | 🟡 Referencia | Si en el futuro hay un drone enterprise, podemos usar EMQX como broker. Pero para MVP, no lo levantamos. |
| **MySQL schema (`cloud_sample.sql`)** | ✅ **SÍ, como referencia** | Las tablas de `manage_device`, `manage_organization`, `manage_user`, etc. son buena inspiración para diseñar nuestro modelo de datos. NO copiar literal, sí adaptar. |
| Java Spring Boot backend | ❌ No | DJI lo discontinuó. Si el día de mañana levantamos Cloud API, reescribimos en Node/Go. |
| Vue 3 + Ant Design frontend | 🟡 Opcional | El webview está pensado para correr DENTRO de Pilot 2. Para nuestra app web pública, Next.js + Tailwind es mejor. |
| Topics MQTT / message structs | ✅ Ya documentados | Están en la sección 3 y 4 de este doc. |
| JSBridge patterns | 🟡 Si integramos Pilot 2 | Leer el código del frontend demo para entender los call sites. Pero no para MVP. |
| Docker con Nginx + WebSocket | 🟡 Patrón | Si en el futuro servimos nuestro propio webview dentro de Pilot 2, este patrón aplica. |

**Lo que recomiendo:**

1. **No levantar el Docker del demo** para "ver si funciona". Sin un drone enterprise, vas a ver un login web y un Pilot 2 que no se puede conectar. **Gasto de tiempo sin retorno.**

2. **Sí leer el `cloud_sample.sql`** del repo `DJI-Cloud-API-Demo` para inspirarnos en el modelo de datos. Es una buena referencia para definir:
   - Estructura de `device` y `organization` (multi-tenant-ready aunque no la usemos)
   - Relaciones entre waylines, tasks, media
   - Tabla de `device_property` para los valores dinámicos de cada dron

3. **Si en el futuro compran un M3E o Dock** (enterprise), ahí SÍ vale la pena levantar el Docker y conectar el drone real para validar. En ese día el setup completo se justifica.

4. **Para MVP, seguir con dji-log-parser + import manual.** Es 10x más simple y cubre el caso M3M sin batallar con Pilot 2, MQTT broker, ni object storage.

---

## 6. JSBridge (Pilot 2 ↔ Webview)

Tu webview H5 (HTML5 en Pilot 2) puede llamar funciones nativas de Pilot 2 vía JSBridge:

| Función | Uso |
|---|---|
| `platformVerifyLicense(appId, appKey, license)` | Verifica tu licencia con Pilot 2 al iniciar |
| `apiGetToken()` | Obtiene el token JWT almacenado por Pilot 2 |
| `platformSetWorkspaceId(uuid)` | Setea el workspace activo |
| `platformSetInformation(platformName, workspaceName, desc)` | Branding del workspace |
| `platformLoadComponent(String name, String param)` | Carga módulos (live, etc.) |

---

## 7. Limitaciones y cosas a saber

- **M3M no soportado oficialmente vía Pilot 2.** Solo aparece en listas broad; setup vía SmartFarm Web no está documentado.
- **Demo oficial discontinuado.** DJI no le da más soporte al código Java Spring Boot.
- **No hay "Get historical flights" como API REST.** Tenés que persistir vos la telemetría en MySQL. Si no persistís en el momento, perdiste.
- **MQTT no es HTTP.** Tu backend necesita mantener conexión persistente, no es REST tradicional.
- **Live streaming requiere servidor RTMP/RTSP/Agora** aparte.
- **MQTT QoS y auth:** por default es anonymous, se puede habilitar TLS con certs (Godaddy compatible).
- **No hay "importador" oficial de vuelos pasados.** El flujo es: dron vuela conectado a tu broker → vos persistís.

---

## 8. Decisión para AeroAdmin AFM

**Conclusión:** Cloud API **NO va al MVP**.

Razones:
1. M3M no está soportado oficialmente vía Pilot 2.
2. Setup = Java Spring Boot + EMQX + MySQL + Redis + JSBridge = 5-8 semanas solo.
3. Demo oficial discontinuado, no esperes parches de DJI.
4. El cliente NO necesita telemetría en vivo — necesita **registro histórico** de operaciones, no dashboard en tiempo real.
5. Solución más simple y robusta para el caso: `dji-log-parser` + import manual de `.txt` del M3M (1-2 sprints).

**Cuándo SÍ reconsiderar Cloud API:**
- Si el cliente compra un M3E o un Dock (enterprise).
- Si pasan a tener 5+ drones y operaciones diarias.
- Si necesitan integración con flotas (multi-drone, multi-operador).

**Mientras tanto, la licencia Cloud API creada queda guardada** (en `docs/DJI_CREDENTIALS.md` que está gitignored). No se pierde.

---

## 9. Referencias y enlaces

| Recurso | URL |
|---|---|
| Doc oficial Cloud API | https://developer.dji.com/doc/cloud-api-tutorial/en/ |
| Source of truth (GitHub) | https://github.com/dji-sdk/Cloud-API-Doc |
| Demo backend (Java) | https://github.com/dji-sdk/DJI-Cloud-API-Demo |
| Demo frontend (Vue) | https://github.com/dji-sdk/Cloud-API-Demo-Web |
| Mín. working example (Python) | https://github.com/pktiuk/DJI_Cloud_API_minimal |
| DJI Developer home | https://developer.dji.com/ |
| DJI Account register | https://account.dji.com/register?appId=dji_sdk |
| SDK Forum | https://sdk-forum.dji.net/hc/en-us |
| dji-log-parser (open source) | https://github.com/lvauvillier/dji-log-parser |

---

## 10. Changelog interno

- **2026-07-22** — Compilado por Mavis. Verificado contra `Cloud-API-Doc` GitHub (canónico) y sitio DJI. Detectada ambigüedad M3M (no en lista Pilot 2, sí en lista broad). Decisión MVP: NO usar Cloud API, usar dji-log-parser.
- **2026-07-22** — Agregada sección 5b "Tutorial Map" con las 15 features completas, las 6 key functions que DJI recomienda para safety, API overview (Dock-only), y FAQ highlights. Confirmado: 9 de 15 features son Dock-only, refuerza que Cloud API está pensado para flotas enterprise, no para el caso M3M del cliente.
- **2026-07-22** — Agregada sección 5c "Environment prepare list + Docker deployment". Verificado stack técnico (Java 11+, MySQL 8.0.26, EMQX 4.4.0, Redis 6.2, Vue 3, Nginx 1.20.2). Confirmado que DJI provee un Docker pre-armado (`cloud_api_sample_docker_v1.0.0.tar`). Conclusión: NO levantar el Docker del demo para MVP (sin drone enterprise no aporta), SÍ usar `cloud_sample.sql` como referencia para diseñar el modelo de datos propio.
