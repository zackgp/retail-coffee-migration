/* global window */
/* eslint-disable react/prefer-es6-class, react/prefer-stateless-function, react/no-unused-class-component-methods, react/destructuring-assignment, react/forbid-prop-types -- exercises legacy createReactClass/context components on purpose */
import '@testing-library/jest-dom'
import React from 'react'
import PropTypes from 'prop-types'
import createReactClass from 'create-react-class'
import { screen } from '@testing-library/react'

import { mockAjax, mountLegacy, renderBackboneApp } from '../helpers/legacy'
import SRApp from 'sr/app'
import Switch from 'sr/components/switch'

describe('G9 legacy test helpers', () => {
  describe('mountLegacy', () => {
    test('mounts a createReactClass (coffee) component with its default props', () => {
      mountLegacy(Switch, { name: 'active' })
      expect(screen.getByText('On')).toBeInTheDocument()
      expect(screen.getByText('Off')).toBeInTheDocument()
    })

    test('provides legacy context to components declaring contextTypes', () => {
      const ShowsContext = createReactClass({
        displayName: 'ShowsContext',
        contextTypes: { label: PropTypes.string },
        render() {
          return React.createElement('span', null, this.context.label)
        },
      })
      mountLegacy(ShowsContext, {}, { context: { label: 'from context' } })
      expect(screen.getByText('from context')).toBeInTheDocument()
    })

    test('fails loudly when required context is missing', () => {
      const NeedsRouter = createReactClass({
        contextTypes: { router: PropTypes.object },
        render() {
          return null
        },
      })
      expect(() => mountLegacy(NeedsRouter, {}, { context: {} })).toThrow('context is missing router')
    })
  })

  describe('mockAjax', () => {
    let ajax

    afterEach(() => ajax.restore())

    test('answers matching requests and records unmatched ones', () => {
      ajax = mockAjax([{ method: 'GET', url: /\/api\/items\/\d+/, response: { id: 7 } }])
      const success = jest.fn()
      const done = jest.fn()
      window.$.ajax({ url: '/api/items/7', success }).done(done)
      expect(success).toHaveBeenCalledWith({ id: 7 }, 'success', expect.any(Object))
      expect(done).toHaveBeenCalledWith({ id: 7 }, 'success', expect.any(Object))

      const error = jest.fn()
      const fail = jest.fn()
      window.$.ajax({ url: '/api/nope', type: 'POST', error }).fail(fail)
      expect(error).toHaveBeenCalled()
      expect(fail).toHaveBeenCalled()
      expect(ajax.unmatched).toEqual(['POST /api/nope'])
      expect(ajax.requests).toHaveLength(2)
    })
  })

  describe('renderBackboneApp', () => {
    test('instantiates a Sagamore.App subclass and runs the handler of the matching route', () => {
      const edit = jest.fn()
      const TestApp = SRApp.extend({ routes: { '': 'list', 'edit/:id(/:section)': 'edit' }, list: jest.fn(), edit })
      const { app, params, handler } = renderBackboneApp(TestApp, { route: 'edit/12/details', prefix: 'things' })
      expect(handler).toBe('edit')
      expect(params).toEqual(['12', 'details'])
      expect(edit).toHaveBeenCalledWith('12', 'details')
      expect(app.prefix).toBe('things')
      expect(app.url('new')).toBe('things/new')
    })

    test('reports routes that do not match', () => {
      const TestApp = SRApp.extend({ routes: { list: 'list' }, list: jest.fn() })
      expect(() => renderBackboneApp(TestApp, { route: 'other' })).toThrow("no route of list matches 'other'")
    })
  })
})
