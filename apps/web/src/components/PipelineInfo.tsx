"use client";

import type { PipelineMeta } from "./types";

type PipelineInfoProps = {
  pipeline: PipelineMeta;
};

export default function PipelineInfo({ pipeline }: PipelineInfoProps) {
  const hasTimings = pipeline.stage_timings && pipeline.stage_timings.length > 0;
  const hasStatus = pipeline.pipeline_status && Object.keys(pipeline.pipeline_status).length > 0;

  if (
    !hasTimings &&
    !hasStatus &&
    !pipeline.mode_confidence &&
    !pipeline.mode_routing_reason &&
    !pipeline.route_key &&
    !pipeline.isolation_scope
  ) {
    return null;
  }

  return (
    <details className="careloop-pipeline">
      <summary className="careloop-pipeline__summary">
        Pipeline
        {pipeline.mode_confidence != null && (
          <span className="careloop-pipeline__conf">
            {Math.round(pipeline.mode_confidence * 100)}% conf
          </span>
        )}
      </summary>
      <div className="careloop-pipeline__body">
        {pipeline.mode_routing_reason && (
          <div className="careloop-pipeline__row">
            <span className="careloop-pipeline__key">Routing</span>
            <span className="careloop-pipeline__val">
              {pipeline.mode_routing_reason.replace(/_/g, " ")}
            </span>
          </div>
        )}
        {pipeline.route_key && (
          <div className="careloop-pipeline__row">
            <span className="careloop-pipeline__key">Route key</span>
            <span className="careloop-pipeline__val">{pipeline.route_key}</span>
          </div>
        )}
        {pipeline.isolation_scope && (
          <div className="careloop-pipeline__row">
            <span className="careloop-pipeline__key">Isolation</span>
            <span className="careloop-pipeline__val">{pipeline.isolation_scope.replace(/_/g, " ")}</span>
          </div>
        )}
        {typeof pipeline.history_turns_used === "number" && (
          <div className="careloop-pipeline__row">
            <span className="careloop-pipeline__key">History used</span>
            <span className="careloop-pipeline__val">
              {pipeline.history_turns_used}
              {pipeline.history_filtered ? " isolated" : " shared"}
            </span>
          </div>
        )}
        {hasStatus && (
          <div className="careloop-pipeline__stages">
            {Object.entries(pipeline.pipeline_status!).map(([stage, status]) => (
              <span
                key={stage}
                className={`careloop-pipeline__stage careloop-pipeline__stage--${status}`}
                title={`${stage}: ${status}`}
              >
                {stage}
              </span>
            ))}
          </div>
        )}
        {hasTimings && (
          <div className="careloop-pipeline__timings">
            {pipeline.stage_timings!.map((t) => (
              <div key={t.stage} className="careloop-pipeline__row">
                <span className="careloop-pipeline__key">{t.stage}</span>
                <span className="careloop-pipeline__val">{t.ms}ms</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
