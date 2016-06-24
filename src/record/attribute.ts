import { setAttribute } from './transactions'
import { notEqual, assign } from '../tools'

import { Owner, Transactional, TransactionOptions } from './types.ts'

export interface IUpdatePipeline{
    canBeUpdated( prev : any, next : any ) : boolean
    transform : Transform
    isChanged( a : any, b : any ) : boolean
    handleChange : ChangeHandler
    clone( value : any ) : any
    toJSON : ( value : any, key : string ) => any
}

export interface IAttributeOptions {
    getHooks : GetHook[]
    transforms : Transform[]
    changeHandlers : ChangeHandler[]
    isRequired? : boolean
    value? : any
    onChange? : ChangeAttrHandler
    type? : Function

    parse? : ( data : any, key : string ) => any
    toJSON? : ( key : string ) => any
}

type GetHook = ( value : any, key : string ) => any;
type Transform = ( next : any, options : {}, prev : any, model : Owner & Transactional ) => any;
type ChangeHandler = ( next : any, prev : any, model : Owner & Transactional ) => void;
export type ChangeAttrHandler = ( ( value : any, attr : string ) => void ) | string;

// TODO: interface differs from options, do something obout it
export class Attribute implements IUpdatePipeline {
    /**
     * Update pipeline functions
     * =========================
     *
     * Stage 0. canBeUpdated( value )
     * - presence of this function implies attribute's ability to update in place.
     */
     canBeUpdated( prev, next ) : boolean {
         return false;
     }

    /**
     * Stage 1. Transform stage
     */
    transform( value, options, prev, model ) { return value; }

    // convert attribute type to `this.type`
    convert( value, options, model ) { return value; }

    /**
     * Stage 2. Check if attr value is changed
     */
    isChanged( a, b ) {
        return notEqual( a, b );
    }

    /**
     * Stage 3. Handle attribute change
     */
    handleChange( next, prev, model ) {}


    /**
     * End update pipeline definitions.
     */

    // create empty object passing backbone options to constructor...
    create( options ) { return new ( <any>this.type )(); }

    // generic clone function for typeless attributes
    // Must be overriden in sublass
    clone( value, options : { deep? : boolean } = {} ) {
        if( value && typeof value === 'object' ) {
            // delegate to object's clone(), if it exist...
            if( value.clone ) {
                return value.clone( options );
            }

            if( options.deep ){
                const proto = Object.getPrototypeOf( value );

                // attempt to deep copy raw objects, assuming they are JSON
                if( proto === Object.prototype || proto === Array.prototype ){
                    return JSON.parse( JSON.stringify( value ) );
                }
            }
        }

        return value;
    }

    validate( model, value, name ) {}

    toJSON( value, key ) {
        return value && value.toJSON ? value.toJSON() : value;
    }

    createPropertyDescriptor() : PropertyDescriptor | void {
        const { name, getHook } = this;

        if( name !== 'id' ){
            return {
                // call to optimized set function for single argument.
                set( value ){
                    setAttribute( <any>this, name, value );
                },

                // attach get hook to the getter function, if present
                get : getHook ?
                      function() {
                          return getHook.call( this, this.attributes[ name ], name );
                      } :
                      function() {
                          return this.attributes[ name ];
                      }
            }
        }
    }

    value : any
    type : Function

    parse : ( value, key : string ) => any

    initialize( name : string, options ){}

    constructor( public name : string, public options : IAttributeOptions ) {
        const {
                  value, type, parse, toJSON,
                  getHooks = [],
                  transforms = [],
                  changeHandlers = []
              } = options;

        this.value = value;
        this.type  = type;

        this.parse  = parse;
        this.toJSON = toJSON === void 0 ? this.toJSON : toJSON;

        /**
         * Assemble pipelines...
         */

        // `convert` is default transform, which is always present...
        this.transform = this.convert;

        // No change handler by default
        this.handleChange = null;

        // Get hook from the attribute will be used first...
        this.getHook = this.get || null;

        // let subclasses configure the pipeline...
        this.initialize.apply( this, arguments );

        // let attribute spec configure the pipeline...
        getHooks.forEach( gh => this.addGetHook( gh ) );
        transforms.forEach( t => this.addTransform( t ) );
        changeHandlers.forEach( ch => this.addChangeHandler( ch ) );
    }

    getHook : ( value, key : string ) => any
    get : ( value, key : string ) => any

    addGetHook( next : GetHook ) : void {
        const prev = this.getHook;

        this.getHook = prev ?
                       function( value, name ) {
                           const next = prev.call( value, name );
                           return next.call( next, name );
                       } : next;
    }

    addTransform( next : Transform ) : void {
        const prev = this.transform;

        this.transform = function( value, options, prev, model ) {
                             const next = prev.call( this, value, options, prev, model );
                             return next.call( this, next, options, prev, model );
                         }
    }

    addChangeHandler( next : ChangeHandler ) : void {
        const prev = this.handleChange;

        this.handleChange = prev ?
                            function( next, prev, model ) {
                                prev.call( this, next, prev, model );
                                next.call( this, next, prev, model );
                            } : next;
    }
}
