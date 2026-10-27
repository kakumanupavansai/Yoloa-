import { useApi } from '../../hooks'
import { examsApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { PageHeader } from '../../components/ui/Primitives'
import QuestionImportPanel from '../../components/admin/QuestionImportPanel'

// Import into any assessment. The same panel is available on each assessment's edit page with the target fixed.
export default function QuestionImport() {
  const exams = useApi(() => examsApi.list(), [])
  return (
    <>
      <PageHeader eyebrow="Administration" title="Question import" subtitle="Add questions to an assessment from an .xlsx workbook. Nothing is saved until you confirm the validated preview." />
      <Async state={exams} label="Loading assessments…">{(rows) => (
        <div className="card card-pad"><QuestionImportPanel exams={rows} /></div>
      )}</Async>
    </>
  )
}
