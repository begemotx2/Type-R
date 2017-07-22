import { AnyType } from './attributes';
import { createAttribute, AttributesValues, CloneAttributesCtor } from './attributes'
import { tools, eventsApi } from '../object-plus'
import { CompiledReference } from '../traversable'

const { defaults, isValidJSON, transform, log } = tools,
      { EventMap } = eventsApi;

/** @private */
export interface DynamicMixin {
    _attributes : AttributesSpec
    Attributes : CloneAttributesCtor
    properties : PropertyDescriptorMap
    forEachAttr? : ForEach
    defaults : Defaults
    _toJSON : ToJSON
    _parse? : Parse
    _localEvents : eventsApi.EventMap
    _keys : string[]
}

// Refine AttributesSpec definition.
/** @private */
export interface AttributesSpec {
    [ key : string ] : AnyType
}

export type ForEach   = ( obj : {}, iteratee : ( val : any, key? : string, spec? : AnyType ) => void ) => void;
export type Defaults  = ( attrs? : {} ) => {}
export type Parse     = ( data : any ) => any;
export type ToJSON    = () => any;

// Compile attributes spec
/** @private */
export function compile( rawSpecs : AttributesValues, baseAttributes : AttributesSpec ) : DynamicMixin {
    const myAttributes = transform( <AttributesSpec>{}, rawSpecs, createAttribute ),
          allAttributes = defaults( <AttributesSpec>{}, myAttributes, baseAttributes ),
          Attributes = createCloneCtor( allAttributes ),
          mixin : DynamicMixin = {
            Attributes : Attributes,
            _attributes : new Attributes( allAttributes ),
            properties : transform( <PropertyDescriptorMap>{}, myAttributes, x => x.createPropertyDescriptor() ),
            defaults : createDefaults( allAttributes ),
            _toJSON : createToJSON( allAttributes ), // <- TODO: profile and check if there is any real benefit. I doubt it. 
            _localEvents : createEventMap( myAttributes ),
            _keys : Object.keys( allAttributes )
         };

    const _parse = createParse( myAttributes, allAttributes );
    if( _parse ){
        mixin._parse = _parse;
    }

    // Enable optimized forEach if warnings are disabled.
    if( !log.level ){
        mixin.forEachAttr = createForEach( allAttributes );
    }

    return mixin;
}

// Build events map for attribute change events.
/** @private */
function createEventMap( attrSpecs : AttributesSpec ) : eventsApi.EventMap {
    let events : eventsApi.EventMap;

    for( var key in attrSpecs ){
        const attribute = attrSpecs[ key ],
            { _onChange } = attribute.options; 

        if( _onChange ){
            events || ( events = new EventMap() );

            events.addEvent( 'change:' + key,
                typeof _onChange === 'string' ?
                    createWatcherFromRef( _onChange, key ) : 
                    wrapWatcher( _onChange, key ) );
        }
    }

    return events;
}

/** @private */
function wrapWatcher( watcher, key ){
    return function( record, value ){
        watcher.call( record, value, key );
    } 
}

/** @private */
function createWatcherFromRef( ref : string, key : string ){
    const { local, resolve, tail } = new CompiledReference( ref, true );
    return local ?
        function( record, value ){
            record[ tail ]( value, key );
        } :
        function( record, value ){
            resolve( record )[ tail ]( value, key );
        }
}

/** @private */
export function createForEach( attrSpecs : AttributesSpec ) : ForEach {
    let statements = [ 'var v, _a=this._attributes;' ];

    for( let name in attrSpecs ){
        statements.push( `( v = a.${name} ) === void 0 || f( v, "${name}", _a.${name} );` );
    }

    return <ForEach> new Function( 'a', 'f', statements.join( '' ) );
}

/** @private */
export function createCloneCtor( attrSpecs : AttributesSpec ) : CloneAttributesCtor {
    var statements = [];

    for( let name in attrSpecs ){
        statements.push( `this.${name} = x.${name};` );
    }

    var CloneCtor = new Function( "x", statements.join( '' ) );
    CloneCtor.prototype = Object.prototype;
    return <CloneAttributesCtor> CloneCtor;
}

// Create optimized model.defaults( attrs, options ) function
/** @private */
function createDefaults( attrSpecs : AttributesSpec ) : Defaults {
    const C

    CreateDefaults.prototype = AssignDefaults.prototype = Object.prototype;

    // Create model.defaults( attrs, options ) function
    // 'attrs' will override default values, options will be passed to nested backbone types
    return function( attrs? : {} ){ //TODO: Consider removing of the CreateDefaults. Currently is not used. May be used in Record costructor, though.
        return attrs ? new AssignDefaults( attrs, this._attributes ) : new CreateDefaults( this._attributes );
    }
}

function createAttributesCtor( attrDesccriptors ){
    const keys = Object.keys( attrDesccriptors ),
        Attributes = new Function( 'r', 'v', 'o', `
            var _attrs = r._attributes;

            ${ keys.map( key =>`
                this.${ key } = _attrs.${ key }.initAttribute( r, v.${ key }, o );
            `) }
        `);

    Attributes.prototype = Object.prototype;

    return Attributes;
}

/** @private */
function createParse( allAttrSpecs : AttributesSpec, attrSpecs : AttributesSpec ) : Parse {
    var statements = [ 'var a=this._attributes;' ],
        create     = false;

    for( let name in allAttrSpecs ){
        const local = attrSpecs[ name ];

        // Is there any 'parse' option in local model definition?
        if( local && local.parse ) create = true;

        // Add statement for each attribute with 'parse' option.
        if( allAttrSpecs[ name ].parse ){
            const s = `r.${name} === void 0 ||( r.${name} = a.${name}.parse.call( this, r.${name}, "${name}") );`;
            statements.push( s );
        }
    }

    if( create ){
        statements.push( 'return r;' );
        return <any> new Function( 'r', statements.join( '' ) );
    }
 }

/** @private */
function createToJSON( attrSpecs : AttributesSpec ) : ToJSON {
    let statements = [ `var json = {},v=this.attributes,a=this._attributes;` ];

    for( let key in attrSpecs ){
        const toJSON = attrSpecs[ key ].toJSON;

        if( toJSON ){
            statements.push( `json.${key} = a.${key}.toJSON.call( this, v.${ key }, '${key}' );` );
        }
    }

    statements.push( `return json;` );

    return <any> new Function( statements.join( '' ) );
}
