import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return path === resolve(root, 'test') ? [] : productionFiles(path)
    return /\.tsx?$/.test(path) && !/\.(test|d)\.tsx?$/.test(path) ? [path] : []
  })
}

function runtimeSpecifiers(text: string, file = 'module.ts'): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const literal = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (
        !clause ||
        (!clause.isTypeOnly &&
          (clause.name ||
            !clause.namedBindings ||
            ts.isNamespaceImport(clause.namedBindings) ||
            clause.namedBindings.elements.length === 0 ||
            clause.namedBindings.elements.some((item) => !item.isTypeOnly)))
      )
        literal(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      if (
        !node.exportClause ||
        !ts.isNamedExports(node.exportClause) ||
        node.exportClause.elements.length === 0 ||
        node.exportClause.elements.some((item) => !item.isTypeOnly)
      )
        literal(node.moduleSpecifier)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      literal(node.arguments[0])
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      literal(node.moduleReference.expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function importGraph(): Map<string, string[]> {
  const files = productionFiles(root)
  const known = new Set(files)
  return new Map(
    files.map((file) => [
      file,
      runtimeSpecifiers(readFileSync(file, 'utf8'), file).flatMap((specifier) => {
        if (!specifier.startsWith('.')) return []
        const base = resolve(dirname(file), specifier)
        const target = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          resolve(base, 'index.ts'),
          resolve(base, 'index.tsx'),
        ].find(existsSync)
        if (!target)
          throw new Error(`Unresolved local import: ${relative(root, file)} → ${specifier}`)
        return known.has(target) ? [target] : []
      }),
    ]),
  )
}

function cycles(graph: Map<string, string[]>): string[] {
  const done = new Set<string>()
  const active: string[] = []
  const found: string[] = []
  const visit = (file: string) => {
    const index = active.indexOf(file)
    if (index >= 0) {
      found.push([...active.slice(index), file].map((path) => relative(root, path)).join(' → '))
      return
    }
    if (done.has(file)) return
    active.push(file)
    for (const dependency of graph.get(file) ?? []) visit(dependency)
    active.pop()
    done.add(file)
  }
  for (const file of graph.keys()) visit(file)
  return found
}

function uniqueModule(graph: Map<string, string[]>, basename: string): string {
  const matches = [...graph.keys()].filter((file) => file.endsWith(`/${basename}.ts`))
  expect(matches, `Expected one ${basename} module`).toHaveLength(1)
  return matches[0]
}

it('keeps selection queries independent of editing reducers', () => {
  const graph = importGraph()
  const state = uniqueModule(graph, 'selectionState')
  const reducers = ['model', 'workspace', 'selectionModel', 'avoidanceModel', 'history'].map(
    (name) => uniqueModule(graph, name),
  )
  const visited = new Set<string>()
  const visit = (file: string) => {
    if (visited.has(file)) return
    visited.add(file)
    for (const dependency of graph.get(file) ?? []) visit(dependency)
  }
  visit(state)
  expect(reducers.filter((file) => visited.has(file))).toEqual([])
})

it('keeps project serialization independent of full geometry acceptance checks', () => {
  const graph = importGraph()
  const format = uniqueModule(graph, 'format')
  const forbidden = ['validation', 'avoidanceValidation', 'sceneView'].map((name) =>
    uniqueModule(graph, name),
  )
  expect(graph.get(format)!.filter((file) => forbidden.includes(file))).toEqual([])
})

it('keeps the complete production runtime import graph acyclic', () => {
  const graph = importGraph()
  expect(graph.size).toBeGreaterThan(80)
  for (const group of ['selection', 'interaction', 'avoidance', 'scene'])
    expect(
      [...graph.keys()].some((file) => file.includes(`/contour/${group}/`)),
      `Missing ${group} graph coverage`,
    ).toBe(true)
  expect(cycles(graph)).toEqual([])
})

it('distinguishes type-only syntax from runtime imports, re-exports and dynamic imports', () => {
  expect(
    runtimeSpecifiers(`
    import type { A } from './type-a'
    import { type B } from './type-b'
    export type { C } from './type-c'
    export { type D } from './type-d'
    import { type E, value } from './mixed'
    import './side-effect'
    import {} from './empty-import'
    import * as ns from './namespace'
    export { type F, another } from './export-mixed'
    export * from './export-all'
    export {} from './empty-export'
    const lazy = import('./lazy')
  `),
  ).toEqual([
    './mixed',
    './side-effect',
    './empty-import',
    './namespace',
    './export-mixed',
    './export-all',
    './empty-export',
    './lazy',
  ])
})
