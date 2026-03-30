import { NextResponse } from 'next/server'
import { getAllAgentTasks } from '@/lib/pipeline'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getAllAgentTasks())
}
