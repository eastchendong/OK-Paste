import type{ExecutionPolicy}from'./contracts';

const SINGLE_PASS:ExecutionPolicy={mode:'single-pass',maxTurns:4,requiresVisualVerification:false};
const BOUNDED_REACT:ExecutionPolicy={mode:'bounded-react',maxTurns:10,requiresVisualVerification:true};

/** Choose the smallest loop that can verify this target's current capability. */
export function executionPolicyFor(kind:string|undefined):ExecutionPolicy{
 if(['word-live','excel-live','powerpoint-live','focused-text'].includes(kind||''))return SINGLE_PASS;
 if(['figma-live','illustrator-live'].includes(kind||''))return{...BOUNDED_REACT,maxTurns:6};
 return BOUNDED_REACT;
}
