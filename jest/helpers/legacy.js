/* global window, document */
/* eslint-disable react/prefer-es6-class -- mountLegacy must support the createReactClass legacy context API */
// G9 (PLAN.md §3): scaffolding for LOCAL smoke tests of legacy (CoffeeScript-era) code and for
// exploring karma -> jest migrations (§4.1). Lives in the retail-coffee-migration repo and is
// only reachable through the sr_web mount (coffee-tools/), so tests committed to the target
// repo must NOT import it (verify.sh step 0c fails on references): when a batch's committed
// test needs one of these helpers, copy the function into the target's src/jest_helpers/ as
// ordinary code in that batch's PR. Committed tests must not load the whole app either.
//
//   import { mockAjax, renderBackboneApp, mountLegacy } from '<path to coffee-tools>/jest/helpers/legacy'
//
// Apps usually rely on the global legacy environment (`sagamore`, Sagamore.*, JST, Backbone
// plugins). Call `loadLegacyApp()` (./legacy_app) in `beforeAll` when the code under test needs
// it — it loads vendor + main like the browser does.
import React from 'react'
import createReactClass from 'create-react-class'
import { render } from '@testing-library/react'

/**
 * Replaces `$.ajax` with a jest mock answering from `routes`:
 *   [{ method: 'GET', url: '/api/items' | /\/api\/items\/\d+/, response: {...}, status: 200 }]
 * Unmatched requests are rejected with a 404 and collected in `unmatched`.
 * Returns { spy, requests, unmatched, restore }.
 */
export function mockAjax(routes = []) {
  const { $ } = window
  const requests = []
  const unmatched = []
  const original = $.ajax
  const spy = jest.fn((urlOrOptions, maybeOptions) => {
    const options = typeof urlOrOptions === 'string' ? { ...maybeOptions, url: urlOrOptions } : { ...urlOrOptions }
    const method = String(options.type || options.method || 'GET').toUpperCase()
    const url = String(options.url || '')
    requests.push({ method, url, data: options.data })
    const route = routes.find(
      (r) => (!r.method || r.method.toUpperCase() === method) && (r.url instanceof RegExp ? r.url.test(url) : r.url === url),
    )
    const deferred = $.Deferred()
    const status = route ? route.status || 200 : 404
    let body = { error: 'not mocked' }
    if (route) body = typeof route.response === 'function' ? route.response(options) : route.response
    const xhr = {
      status,
      responseText: typeof body === 'string' ? body : JSON.stringify(body),
      responseJSON: body,
      getResponseHeader: (h) => (route && route.headers ? route.headers[h] ?? null : null),
    }
    if (!route) unmatched.push(`${method} ${url}`)
    if (status < 400) {
      if (options.success) options.success(body, 'success', xhr)
      deferred.resolve(body, 'success', xhr)
    } else {
      if (options.error) options.error(xhr, 'error', 'Not Found')
      deferred.reject(xhr, 'error', 'Not Found')
    }
    if (options.complete) options.complete(xhr, status < 400 ? 'success' : 'error')
    return deferred.promise(xhr)
  })
  $.ajax = spy
  return {
    spy,
    requests,
    unmatched,
    restore() {
      $.ajax = original
    },
  }
}

function routeRegExp(route) {
  // same conversion as Backbone.Router.prototype._routeToRegExp (Backbone 1.0)
  return new RegExp(
    `^${route
      .replace(/[-{}[\]+?.,\\^$|#\s]/g, '\\$&')
      .replace(/\((.*?)\)/g, '(?:$1)?')
      .replace(/(\(\?)?:\w+/g, (match, optional) => (optional ? match : '([^/]+)'))
      .replace(/\*\w+/g, '(.*?)')}$`,
  )
}

/**
 * Instantiates a Backbone-style App (Sagamore.App subclass) the way apps.coffee does and runs
 * the handler matching `route` (relative to the app prefix), rendering into #content.
 *   const { app, container, handler } = renderBackboneApp(SettingsApp, { route: 'edit/12', prefix: 'settings' })
 * Combine with mockAjax() for the requests the app makes.
 */
export function renderBackboneApp(AppClass, { route = '', prefix = 'test-app', module = 'test', options = {} } = {}) {
  let container = document.getElementById('content')
  if (!container) {
    container = document.createElement('div')
    container.id = 'content'
    document.body.appendChild(container)
  }
  const app = new AppClass({ prefix, module, ...options })
  if (app.id == null) app.id = prefix.replace('/', '--')
  const routes = typeof AppClass.prototype.routes === 'function' ? AppClass.prototype.routes.call(app) : AppClass.prototype.routes || {}
  const match = Object.keys(routes)
    .map((pattern) => ({ pattern, m: routeRegExp(pattern).exec(route) }))
    .find((x) => x.m)
  if (!match) throw new Error(`renderBackboneApp: no route of ${Object.keys(routes).join(', ')} matches '${route}'`)
  const handlerSpec = routes[match.pattern]
  const handler = typeof handlerSpec === 'string' ? app[handlerSpec] : handlerSpec
  if (typeof handler !== 'function') throw new Error(`renderBackboneApp: handler ${handlerSpec} is not a method of the app`)
  const params = match.m.slice(1).map((p) => (p == null ? null : decodeURIComponent(p)))
  const result = handler.apply(app, params)
  return { app, container, handler: handlerSpec, params, result }
}

/**
 * Mounts a createReactClass or class component with the legacy context API.
 *   mountLegacy(Component, props, { context: { router }, wrapper })
 * `context` is provided through a createReactClass parent declaring childContextTypes for the
 * component's contextTypes. Returns the @testing-library/react render result.
 */
export function mountLegacy(Component, props = {}, { context, wrapper } = {}) {
  let element = React.createElement(Component, props)
  if (context) {
    const childContextTypes = Component.contextTypes || {}
    const missing = Object.keys(childContextTypes).filter((k) => !(k in context))
    if (missing.length) throw new Error(`mountLegacy: context is missing ${missing.join(', ')}`)
    const LegacyContext = createReactClass({
      displayName: 'LegacyContext', // eslint-disable-line react/no-unused-class-component-methods -- read by React devtools
      childContextTypes, // eslint-disable-line react/no-unused-class-component-methods -- read by React
      getChildContext() {
        return context
      },
      render() {
        const { children } = this.props // eslint-disable-line react/prop-types -- test-only wrapper
        return children
      },
    })
    element = React.createElement(LegacyContext, null, element)
  }
  return render(element, wrapper ? { wrapper } : undefined)
}
