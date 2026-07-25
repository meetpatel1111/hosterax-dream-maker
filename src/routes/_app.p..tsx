import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/p/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_app/p/"!</div>
}
