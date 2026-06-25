// GraphQL queries de DJI AG — endpoint coreano (`kr-ag2-api.dji.com`).
//
// Contexto (2026-06-19):
//   - El frontend de DJI SmartFarm rutea al backend coreano cuando el
//     `accept-language` del browser es `zh-CN,zh` (caso típico de sesiones
//     internacionales). El backend regional (`agro-vg.djiag.com`) usa otro
//     patrón — son backends distintos para la misma UI.
//   - Estos queries son los que dispara el frontend al cargar la página
//     de Field Management (`/mission` → click en "Field Management" del
//     sidebar). Capturamos las responses vía Playwright.
//
// Por qué este archivo existe separado del client:
//   - Las queries son datos puros, no tienen side effects → se pueden
//     versionar, testear, y referenciar desde otros scripts (smoke, importers).
//   - El client las usa al navegar; el importer las usa si alguna vez
//     queremos hacer llamadas API directas (saltando el browser).
//
// Estructura de las variables:
//   - `lands`: cursor-based pagination (first, after). `bbox` es un filtro
//     de viewport — para fetchear TODAS las fincas del usuario, usar
//     bbox mundial (lat [-90,90], lng [-180,180]).
//   - `landsCluster`: sin paginación confirmada — se infiere del frontend.
//     Si el usuario reporta que el shape es distinto, ajustar acá.
//
// Formato de las queries: STRING sin procesar. Playwright las serializa
// tal cual al hacer fetch (el browser se encarga del HMAC signing via
// el código de DJI). NO incluir `\n` o indentación que cambien el
// content-md5 (el signature se calcula sobre el body exacto).

/**
 * Query para listar todas las fincas del usuario. Cursor-based pagination.
 * Variables: { first: number, after: string, bbox: { upperRight, downLeft } | null }
 */
const LANDS_QUERY = `query {
      lands(first: 200, after: "0", filter: {
        enableFreeZone: true,
        bbox: {
  upperRight: {
    lat: 90
    lng: 180
  }
  downLeft: {
    lat: -90
    lng: -180
  }
},
        tags: [],
        nameLike: ""
      }) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node{
            uuid
externalId
name
address
updatedAt
createdAt
totalArea(unit:MU)
workArea(unit:MU)
totalObstacleArea(unit:MU)
sourceType
landType
precision
precisionType
maxGeometryParameterOffset
position {
  lng
  lat
}
geometry {
  storage {
    signedURL
    uuid
    contentMd5
  }
}
waypoint {
  storage {
    signedURL
  }
}
parameter {
  storage {
    signedURL
  }
}
serialNumber
bbox {
  upperRight{
    lat
    lng
  }
  downLeft {
    lat
    lng
  }
}
tags

          }
        }
      }
    }
    `;

/**
 * Query para obtener clusters de fincas (visualización, no del dominio).
 * Solo trae `center`, `count`, `bbox` — sin nombres ni UUIDs. Sirve
 * para el heatmap, no para enriquecer fincas. No hay totalCount —
 * solo pageInfo.hasNextPage.
 *
 * Variables: { first: number, after: string, bbox: { upperRight, downLeft }, zoomLevel: number }
 * Confirmado contra captura de DevTools del 2026-06-19.
 */
const LANDS_CLUSTER_QUERY = `query {
      landsCluster(first: 200, after: "0", filter: {
        enableFreeZone: true,
        bbox: {
  upperRight: {
    lat: 90
    lng: 180
  }
  downLeft: {
    lat: -90
    lng: -180
  }
},
        zoomLevel: 4
      }) {
        pageInfo {
          hasNextPage
        }
        edges {
          cursor
          node {
            center {
              lat
              lng
            }
            count
            bbox {
              upperRight{
                lat
                lng
              }
              downLeft {
                lat
                lng
              }
            }
          }
        }
      }
    }
    `;

module.exports = {
  LANDS_QUERY,
  LANDS_CLUSTER_QUERY
};
